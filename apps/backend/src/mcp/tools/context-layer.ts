import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeSql, grep, list, readFile } from '@nao/shared/tools';
import { z } from 'zod';
import zodV3 from 'zod/v3';

import executeSqlTool from '../../agents/tools/execute-sql';
import grepTool from '../../agents/tools/grep';
import listTool from '../../agents/tools/list';
import readTool from '../../agents/tools/read';
import * as chatQueries from '../../queries/chat.queries';
import { upsertMcpQueryData } from '../../queries/mcp-query-data.queries';
import * as storyQueries from '../../queries/story.queries';
import * as storyFolderQueries from '../../queries/story-folder.queries';
import { pinQueryDataToChat, pinStoryMessageToChat } from '../../utils/chat-message-story';
import { resolveStoryQueryData, type StoryQueryDataMap } from '../../utils/story-query-data';
import { STORY_OUTPUT_SCHEMA, type StoryMcpToolPayload } from '../embed/embed-tool-result';
import { STORY_APP_URI, uiToolMeta } from '../embed/ui-resources';
import type { McpContext } from '../logging';
import { storyChatUrl, storyEmbedUrl, storyUrl } from '../urls';
import { buildStoryMcpResultWithSandbox, fetchLatestStoryVersion, resolveChartChatId, resolveStory } from './helpers';
import { registerAgentToolAsMcp, registerMcpTool } from './register-mcp-tool';

const EXECUTE_SQL_DESCRIPTION =
	'Run a single SQL query against the connected warehouse. Read-only unless the workspace admin ' +
	'has enabled write permissions.\n\n' +
	'USE WHEN: you already know the SQL (or have a precise question that maps to one query).\n' +
	"SKIP WHEN: you'd need to discover available tables/metrics first → call `ls_nao_context` + " +
	'`read_nao_context` on RULES.md, or delegate the whole task to `ask_nao`.\n\n' +
	'BEFORE RUNNING: if you have not yet read RULES.md in this session, call ' +
	'`read_nao_context` on `RULES.md` (or `grep_nao_context`) first to learn the schema, ' +
	'naming conventions, and business rules. Skip this step only if `ask_nao` already ran the query.';

const GREP_DESCRIPTION =
	'Search a regex across the nao project context files.\n\n' +
	'USE WHEN: you need to discover available metrics, tables, or business rules before writing SQL ' +
	'("find anything about churn", "locate the orders table definition").\n' +
	'SKIP WHEN: you want to browse a folder rather than match text → use `ls`.';

const LS_DESCRIPTION =
	'List files and folders in the nao project context at a given path.\n\n' +
	'Best practice: start with `ls .` and `read` RULES.md before any `execute_sql` — it documents ' +
	'the data model, naming conventions, and business definitions.';

const READ_DESCRIPTION =
	'Read the full contents of a file in the nao project context.\n\n' +
	'USE WHEN: you have a specific path (typically located via `ls` or `grep`) and need the whole ' +
	'file — e.g. read RULES.md before writing SQL, or columns.md to confirm column names and types.\n' +
	'SKIP WHEN: matching lines are enough → use `grep`. You want to browse a folder → use `ls`.';

const CREATE_STORY_DESCRIPTION =
	'Create a new analytics story — a markdown document with embedded `<chart>` / `<table>` / `<grid>` ' +
	'blocks rendered by nao (think dashboard or report).\n\n' +
	'Typical flow: `execute_sql` → `display_chart` → paste the returned `<chart>` block into `content`. ' +
	'Pass `chat_id` to attach the story to a chat (e.g. from `ask_nao`); omit it for a standalone ' +
	'project-level story. The chat must belong to the calling user.\n\n' +
	'IMPORTANT: once `create_story` returns, present its output directly to the user. Do NOT call ' +
	'`display_chart` again for charts already embedded in the story content — the story embed renders ' +
	'them automatically and re-calling `display_chart` would duplicate the output.';

const UPDATE_STORY_DESCRIPTION =
	"Update a story's title and/or full content. Creates a new version; omit a field to keep its " +
	'current value.\n\n' +
	'When swapping charts, regenerate the `<chart>` block via `display_chart` first so the embed ' +
	'stays valid.';

type ExecuteSqlMcpInput = executeSql.Input & { chat_id?: string };

const EXECUTE_SQL_INPUT_SCHEMA = executeSql.InputSchema.extend({
	chat_id: zodV3
		.string()
		.optional()
		.describe(
			'Chat UUID to associate this query with (e.g. `chatId` from `ask_nao`). ' +
				"Sets the 'Open in nao' button on any chart later rendered from this `query_id`.",
		),
});

export function registerContextLayerTools(server: McpServer, ctx: McpContext): void {
	registerFileTools(server, ctx);
	registerExecuteSql(server, ctx);
	registerContextStoryTools(server, ctx);
}

function registerFileTools(server: McpServer, ctx: McpContext): void {
	registerAgentToolAsMcp(server, ctx, {
		name: 'ls_nao_context',
		agentTool: listTool,
		title: 'List Files',
		description: LS_DESCRIPTION,
		inputSchema: list.InputSchema,
		outputSchema: list.OutputSchema.shape,
	});

	registerAgentToolAsMcp(server, ctx, {
		name: 'grep_nao_context',
		agentTool: grepTool,
		title: 'Search Files',
		description: GREP_DESCRIPTION,
		inputSchema: grep.InputSchema,
		outputSchema: grep.OutputSchema.shape,
	});

	registerAgentToolAsMcp(server, ctx, {
		name: 'read_nao_context',
		agentTool: readTool,
		title: 'Read File',
		description: READ_DESCRIPTION,
		inputSchema: readFile.InputSchema,
		outputSchema: readFile.OutputSchema.shape,
	});
}

function registerExecuteSql(server: McpServer, ctx: McpContext): void {
	registerAgentToolAsMcp<executeSql.Input, executeSql.Output, ExecuteSqlMcpInput>(server, ctx, {
		name: 'execute_sql',
		agentTool: executeSqlTool,
		title: 'Execute SQL',
		description: EXECUTE_SQL_DESCRIPTION,
		inputSchema: EXECUTE_SQL_INPUT_SCHEMA,
		outputSchema: executeSql.OutputSchema.extend({
			query_id: zodV3
				.string()
				.describe(
					'Reusable query ID — pass to `display_chart` as `query_id`, or embed as `<table query_id="..." />`.',
				),
		}).shape,
		mapInput: ({ chat_id: _chatId, ...input }) => input,
		resolveChatId: (input) => input.chat_id ?? null,
		formatResult: async ({ input, output, callLogId }) => {
			const queryId = output.id;
			const validatedSourceChat = await resolveChartChatId(input.chat_id, ctx);

			await upsertMcpQueryData(queryId, callLogId, ctx.projectId, output.columns, output.data, {
				sourceChatId: validatedSourceChat ?? null,
			});

			const mcpOutput = { ...output, query_id: queryId };
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(mcpOutput) }],
				structuredContent: mcpOutput,
			};
		},
	});
}

function registerContextStoryTools(server: McpServer, ctx: McpContext): void {
	registerMcpTool(server, ctx, {
		name: 'create_story',
		title: 'Create Story',
		description: CREATE_STORY_DESCRIPTION,
		inputSchema: {
			title: z.string().describe('Story title.'),
			content: z
				.string()
				.optional()
				.describe(
					'Full nao story markdown (with `<chart>`, `<table>`, `<grid>` blocks). Omit to start from a title-only stub.',
				),
			query_data: z
				.record(
					z.string(),
					z.object({ columns: z.array(z.string()), data: z.array(z.record(z.string(), z.unknown())) }),
				)
				.optional()
				.describe(
					"Pre-fetched rows keyed by `query_id`, used to seed the story's embedded `<chart>` / `<table>` blocks. " +
						'Provide entries for `query_id`s coming from `ask_nao`; `query_id`s from MCP `execute_sql` are already cached.',
				),
			chat_id: z
				.string()
				.optional()
				.describe(
					'Attach the story to a chat (e.g. `chatId` from `ask_nao`). Omit for a standalone story. The chat must belong to the calling user.',
				),
		},
		outputSchema: STORY_OUTPUT_SCHEMA,
		_meta: uiToolMeta(STORY_APP_URI),
		handler: async ({ title, content, query_data, chat_id }) => {
			const slug = generateSlug(title);
			const code = content ?? `# ${title}\n`;
			const story = chat_id
				? await createChatLinkedStory({ chatId: chat_id, slug, title, code, ctx })
				: await createStandaloneStory({ slug, title, code, ctx });

			if ('error' in story) {
				return { content: [{ type: 'text' as const, text: `Error: ${story.error}` }], isError: true };
			}

			await cacheStoryQueryData(story.id, code, query_data, chat_id, ctx);

			const storyForUrl = { id: story.id, slug: story.slug, chatId: story.chatId };
			const embedUrl = storyEmbedUrl(story.id, ctx.projectId);
			const output: StoryMcpToolPayload = {
				embedUrl,
				id: story.id,
				title: story.title,
				createdAt: story.createdAt,
				url: storyUrl(storyForUrl),
				chatUrl: storyChatUrl(storyForUrl),
			};
			return buildStoryMcpResultWithSandbox(output, ctx, code, story.chatId);
		},
	});

	registerMcpTool(server, ctx, {
		name: 'update_story',
		title: 'Update Story',
		description: UPDATE_STORY_DESCRIPTION,
		inputSchema: {
			story_id: z
				.string()
				.describe(
					'Story UUID (from `list_stories.id`, `ask_nao.stories[].id`, or a prior `create_story`). Not the slug.',
				),
			title: z.string().optional().describe('New title. Omit to keep current.'),
			content: z
				.string()
				.optional()
				.describe(
					'Full markdown replacement (with `<chart>`, `<table>`, `<grid>` blocks). ' +
						'Omit to keep the current content — partial diffs are not supported.',
				),
			query_data: z
				.record(
					z.string(),
					z.object({ columns: z.array(z.string()), data: z.array(z.record(z.string(), z.unknown())) }),
				)
				.optional()
				.describe(
					'Pre-fetched rows keyed by `query_id`, used to seed any new `<chart>` / `<table>` blocks introduced by this revision. ' +
						'Provide entries for `query_id`s coming from `ask_nao`; `query_id`s from MCP `execute_sql` are already cached.',
				),
			chat_id: z
				.string()
				.optional()
				.describe(
					'Chat UUID to associate this revision with (e.g. `chatId` from `ask_nao`). ' +
						"Sets the 'Open in nao' button on the story's embedded charts.",
				),
		},
		outputSchema: STORY_OUTPUT_SCHEMA,
		_meta: uiToolMeta(STORY_APP_URI),
		handler: async ({ story_id, title, content, query_data, chat_id }) => {
			const story = await resolveStory(story_id, ctx);
			const latestVersion = await fetchLatestStoryVersion(story);
			const newTitle = title ?? story.title;
			const newCode = content ?? latestVersion?.code ?? `# ${newTitle}\n`;
			const updated = await saveNewVersion(story, ctx, newTitle, newCode);
			const embedUrl = storyEmbedUrl(story.id, ctx.projectId);
			const validatedChatId = await resolveChartChatId(chat_id, ctx);
			const effectiveChatId = validatedChatId ?? story.chatId ?? undefined;
			await cacheStoryQueryData(story.id, newCode, query_data, effectiveChatId, ctx);
			const output: StoryMcpToolPayload = {
				embedUrl,
				...updated,
				url: storyUrl(story),
				chatUrl: storyChatUrl(story),
			};
			return buildStoryMcpResultWithSandbox(output, ctx, newCode, effectiveChatId);
		},
	});
}

async function cacheStoryQueryData(
	storyId: string,
	code: string,
	queryData: StoryQueryDataMap | undefined,
	chatId: string | null | undefined,
	ctx: McpContext,
): Promise<void> {
	const existingCache = await storyQueries.getStoryDataCacheByStoryId(storyId);
	const seededQueryData: StoryQueryDataMap = {
		...((existingCache?.queryData as StoryQueryDataMap | null) ?? {}),
		...(queryData ?? {}),
	};
	const resolvedQueryData = await resolveStoryQueryData(
		code,
		Object.keys(seededQueryData).length > 0 ? seededQueryData : null,
		ctx.projectId,
		ctx.userId,
	);
	if (!resolvedQueryData) {
		return;
	}
	await storyQueries.upsertStoryDataCacheByStoryId(storyId, resolvedQueryData);
	if (chatId) {
		await pinQueryDataToChat(chatId, resolvedQueryData);
	}
}

function generateSlug(title: string): string {
	return (
		title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'untitled'
	);
}

type CreatedStory = { id: string; title: string; slug: string; chatId: string | null; createdAt: Date };
type CreateStoryResult = CreatedStory | { error: string };

async function createStandaloneStory(args: {
	slug: string;
	title: string;
	code: string;
	ctx: McpContext;
}): Promise<CreateStoryResult> {
	const story = await storyQueries.createStandaloneStory({
		userId: args.ctx.userId,
		projectId: args.ctx.projectId,
		slug: args.slug,
		title: args.title,
		code: args.code,
		source: 'user',
	});

	if (!story) {
		return {
			error: `A story with title "${args.title}" already exists. Pick a different title or use update_story.`,
		};
	}

	await storyFolderQueries.saveStoryInPrivateRoot(args.ctx.userId, args.ctx.projectId, story.id);
	return { ...story, chatId: null };
}

async function createChatLinkedStory(args: {
	chatId: string;
	slug: string;
	title: string;
	code: string;
	ctx: McpContext;
}): Promise<CreateStoryResult> {
	const ownerId = await chatQueries.getChatOwnerId(args.chatId);
	if (ownerId !== args.ctx.userId) {
		return { error: `Chat not found: ${args.chatId}` };
	}
	const chatProjectId = await chatQueries.getChatProjectId(args.chatId);
	if (chatProjectId !== args.ctx.projectId) {
		return { error: `Chat not found: ${args.chatId}` };
	}

	const existing = await storyQueries.getStoryByChatAndSlug(args.chatId, args.slug);
	if (existing) {
		return {
			error: `A story with title "${args.title}" already exists in this chat. Pick a different title or use update_story.`,
		};
	}

	const version = await storyQueries.createStoryVersion({
		chatId: args.chatId,
		slug: args.slug,
		title: args.title,
		code: args.code,
		action: 'create',
		source: 'assistant',
	});
	const created = await storyQueries.getStoryByChatAndSlug(args.chatId, args.slug);
	if (!created) {
		throw new Error(`Failed to retrieve created story: ${args.chatId}/${args.slug}`);
	}

	await storyFolderQueries.saveStoryInPrivateRoot(args.ctx.userId, args.ctx.projectId, created.id);

	await pinStoryMessageToChat({
		chatId: args.chatId,
		slug: args.slug,
		title: args.title,
		code: args.code,
		version: version.version,
	});

	return {
		id: created.id,
		title: created.title,
		slug: created.slug,
		chatId: created.chatId,
		createdAt: created.createdAt,
	};
}

async function saveNewVersion(
	story: { id: string; slug: string; chatId: string | null },
	ctx: McpContext,
	title: string,
	code: string,
): Promise<{ id: string; title: string; updatedAt: Date }> {
	if (story.chatId) {
		await storyQueries.createStoryVersion({
			chatId: story.chatId,
			slug: story.slug,
			title,
			code,
			action: 'update',
			source: 'user',
		});
		const updated = await storyQueries.getStoryByChatAndSlug(story.chatId, story.slug);
		if (!updated) {
			throw new Error(`Failed to retrieve updated story: ${story.chatId}/${story.slug}`);
		}
		return { id: updated.id, title: updated.title, updatedAt: updated.updatedAt };
	}

	await storyQueries.createStandaloneVersion({
		userId: ctx.userId,
		projectId: ctx.projectId,
		slug: story.slug,
		title,
		code,
		action: 'update',
		source: 'user',
	});
	const updated = await storyQueries.getStandaloneStoryByUserAndSlug(ctx.userId, ctx.projectId, story.slug);
	if (!updated) {
		throw new Error(`Failed to retrieve updated story: ${ctx.userId}/${story.slug}`);
	}
	return { id: updated.id, title: updated.title, updatedAt: updated.updatedAt };
}
