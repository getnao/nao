import { randomUUID } from 'node:crypto';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildStoryChartBlock } from '@nao/shared';
import { displayChart, executeSql } from '@nao/shared/tools';
import { z } from 'zod';
import zodV3 from 'zod/v3';

import displayChartTool from '../../agents/tools/display-chart';
import executeSqlTool from '../../agents/tools/execute-sql';
import grepTool from '../../agents/tools/grep';
import listTool from '../../agents/tools/list';
import * as chatQueries from '../../queries/chat.queries';
import { insertMcpChartEmbed } from '../../queries/mcp-chart-embed.queries';
import { getMcpQueryData, upsertMcpQueryData } from '../../queries/mcp-query-data.queries';
import type { UserStoryRow } from '../../queries/story.queries';
import * as storyQueries from '../../queries/story.queries';
import { pinQueryDataToChat, pinStoryMessageToChat } from '../../utils/chat-message-story';
import { logger } from '../../utils/logger';
import { resolveStoryQueryData, type StoryQueryDataMap } from '../../utils/story-query-data';
import {
	buildChartToolResult,
	buildStoryToolResult,
	type ChartToolPayload,
	type StoryMcpToolPayload,
} from '../embed/embed-tool-result';
import { buildChartSandboxHtml, buildStorySandboxHtml } from '../embed/sandbox-html';
import { CHART_APP_URI, STORY_APP_URI, uiToolMeta } from '../embed/ui-resources';
import { defineMcpHandler, type McpContext, type ToolResult } from '../logging';
import { chartEmbedUrl, chatUrl, storyChatUrl, storyEmbedUrl, storyUrl } from '../urls';
import { registerAgentToolAsMcp } from './wrap-agent-tool';

const EXECUTE_SQL_DESCRIPTION =
	'Run a single SQL query against the connected warehouse. Read-only unless the workspace admin ' +
	'has enabled write permissions.\n\n' +
	'USE WHEN: you already know the SQL (or have a precise question that maps to one query).\n' +
	"SKIP WHEN: you'd need to discover available tables/metrics first → call `ls` + `grep` to read " +
	'RULES.md and columns docs, or delegate the whole task to `ask_nao`.\n\n' +
	'Returns rows as JSON and a `query_id` you can feed into `display_chart` or embed in a story ' +
	'as `<table query_id="..." />`. Optional `chat_id` attaches the query to a chat (e.g. from ' +
	'`ask_nao`) so its embeds can link back.';

const DISPLAY_CHART_DESCRIPTION =
	'Render an interactive chart embed from a previously executed query.\n\n' +
	'USE WHEN: you have a `query_id` — either fresh from `execute_sql` or returned by a prior ' +
	'`ask_nao` in its `charts` array — and want a shareable embed URL or a `<chart>` block to drop ' +
	'into a story.\n' +
	"SKIP WHEN: you don't have data yet → run `execute_sql` first, or `ask_nao` to let nao handle " +
	'both the SQL and the chart in one shot.\n\n' +
	"If the `query_id` comes from an `ask_nao` chat, pass that chat's `chat_id` so nao loads the rows " +
	'from history (no need to re-run the SQL) and caches them for the embed.\n\n' +
	'Returns the embed URL, the `<chart>` block ready to paste into a story, and a sandbox HTML preview.';

const GREP_DESCRIPTION =
	'Search a regex across the nao project context files (RULES.md, columns/*.md, semantic layer, ' +
	'docs). Respects .naoignore.\n\n' +
	'USE WHEN: you need to discover available metrics, tables, or business rules before writing SQL ' +
	'("find anything about churn", "locate the orders table definition").\n' +
	'SKIP WHEN: you want to browse a folder rather than match text → use `ls`.';

const LS_DESCRIPTION =
	'List files and folders in the nao project context at a given path.\n\n' +
	'USE WHEN: exploring the project structure for the first time, locating RULES.md, or finding ' +
	'available columns/metrics docs.\n' +
	'SKIP WHEN: you already know the file you want to search inside → use `grep`.\n\n' +
	'Best practice: start with `ls .` and read RULES.md before any `execute_sql` — it documents the ' +
	'data model, naming conventions, and business definitions.';

const CREATE_STORY_DESCRIPTION =
	'Create a new analytics story — a markdown document with embedded `<chart>` / `<table>` / `<grid>` ' +
	'blocks rendered by nao (think dashboard or report).\n\n' +
	'USE WHEN: the user wants a persistent shareable document or to materialise findings beyond ' +
	'the chat.\n' +
	'SKIP WHEN: a single chart embed is enough → use `display_chart` alone.\n\n' +
	'Typical flow: `execute_sql` → `display_chart` → paste the returned `<chart>` block into `content`. ' +
	'Pass `chat_id` to attach the story to a chat (e.g. from `ask_nao`); omit it for a standalone ' +
	'project-level story. The chat must belong to the calling user.';

const UPDATE_STORY_DESCRIPTION =
	"Update a story's title and/or full content. Creates a new version; omit a field to keep its " +
	'current value.\n\n' +
	'USE WHEN: editing an existing story you obtained via `list_stories` or `get_story`.\n' +
	"SKIP WHEN: the story doesn't exist yet → use `create_story`.\n\n" +
	'When swapping charts, regenerate the `<chart>` block via `display_chart` first so the embed ' +
	'stays valid.';

type ExecuteSqlMcpInput = executeSql.Input & { chat_id?: string };
type DisplayChartMcpInput = displayChart.Input & { chat_id?: string };

const EXECUTE_SQL_INPUT_SCHEMA = executeSql.InputSchema.extend({
	chat_id: zodV3
		.string()
		.optional()
		.describe(
			'Chat UUID to associate this query with (e.g. `chatId` from `ask_nao`). ' +
				"Sets the 'Open in nao' button on any chart later rendered from this `query_id`.",
		),
});

const DISPLAY_CHART_INPUT_SCHEMA = displayChart.InputSchema.extend({
	chat_id: zodV3
		.string()
		.optional()
		.describe(
			'Chat UUID the chart belongs to (e.g. `chatId` from `ask_nao`). ' +
				'Required when `query_id` was produced by an `ask_nao` — nao then loads the rows from chat history and the embed links back to that chat.',
		),
});

export function registerContextLayerTools(server: McpServer, ctx: McpContext): void {
	registerFileTools(server, ctx);
	registerDataTools(server, ctx);
	registerContextStoryTools(server, ctx);
}

function registerFileTools(server: McpServer, ctx: McpContext): void {
	registerAgentToolAsMcp(server, ctx, {
		name: 'ls',
		agentTool: listTool,
		title: 'List Files',
		description: LS_DESCRIPTION,
	});

	registerAgentToolAsMcp(server, ctx, {
		name: 'grep',
		agentTool: grepTool,
		title: 'Search Files',
		description: GREP_DESCRIPTION,
	});
}

function registerDataTools(server: McpServer, ctx: McpContext): void {
	registerAgentToolAsMcp<executeSql.Input, executeSql.Output, ExecuteSqlMcpInput>(server, ctx, {
		name: 'execute_sql',
		agentTool: executeSqlTool,
		title: 'Execute SQL',
		description: EXECUTE_SQL_DESCRIPTION,
		inputSchema: EXECUTE_SQL_INPUT_SCHEMA,
		mapInput: ({ chat_id: _chatId, ...input }) => input,
		resolveChatId: (input) => input.chat_id ?? null,
		formatResult: async ({ input, output, callLogId }) => {
			const queryId = output.id;
			const validatedSourceChat = await resolveChartChatId(input.chat_id, ctx.userId);

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

	registerAgentToolAsMcp<displayChart.Input, displayChart.Output, DisplayChartMcpInput>(server, ctx, {
		name: 'display_chart',
		agentTool: displayChartTool,
		title: 'Display Chart',
		description: DISPLAY_CHART_DESCRIPTION,
		inputSchema: DISPLAY_CHART_INPUT_SCHEMA,
		_meta: uiToolMeta(CHART_APP_URI),
		mapInput: ({ chat_id: _chatId, ...input }) => input,
		resolveChatId: (input) => input.chat_id ?? null,
		formatResult: async ({ input, output, callLogId }) => {
			const { query_id, chart_type, x_axis_key, x_axis_type, series, title, chat_id } = input;
			if (!output.success) {
				return {
					content: [{ type: 'text' as const, text: output.error ?? 'Chart config is invalid.' }],
					isError: true,
				};
			}

			const block = buildStoryChartBlock({ query_id, chart_type, x_axis_key, x_axis_type, series, title });

			const validatedChatId = await resolveChartChatId(chat_id, ctx.userId);

			let queryData = await getMcpQueryData(query_id, ctx.projectId);
			if (!queryData && validatedChatId) {
				const fromChat = await chatQueries.getQueryResultByQueryId(validatedChatId, query_id);
				if (fromChat) {
					await upsertMcpQueryData(query_id, callLogId, ctx.projectId, fromChat.columns, fromChat.data, {
						sourceChatId: validatedChatId,
					});
					queryData = { ...fromChat, sourceChatId: validatedChatId };
				}
			}

			if (!queryData) {
				const errorMsg =
					`query_id "${query_id}" not found in cache. ` +
					(chat_id
						? `No matching execute_sql result found in chat ${chat_id}.`
						: 'Pass `chat_id` if the query was produced by a prior `ask_nao` call.');
				return {
					content: [{ type: 'text' as const, text: errorMsg }],
					isError: true,
				};
			}

			let chartEmbedId: string | null = null;
			let embedUrl: string | null = null;
			try {
				const id = randomUUID();
				const inserted = await insertMcpChartEmbed({
					chartEmbedId: id,
					queryId: query_id,
					projectId: ctx.projectId,
					chartConfig: { chartType: chart_type, xAxisKey: x_axis_key, xAxisType: x_axis_type, series, title },
					sourceChatId: validatedChatId ?? null,
				});
				if (inserted) {
					chartEmbedId = id;
					embedUrl = chartEmbedUrl(id, ctx.projectId);
				}
			} catch (dbErr) {
				logger.warn(`MCP display_chart: chart embed persistence failed: ${String(dbErr)}`, { source: 'tool' });
			}

			const naoChatUrl = validatedChatId ? chatUrl(validatedChatId) : null;
			let sandboxChartHtml: string | null = null;
			try {
				sandboxChartHtml = buildChartSandboxHtml({
					title,
					chartBlock: block,
					queryId: query_id,
					columns: queryData.columns,
					data: queryData.data,
					naoChatUrl,
				});
			} catch (sandboxErr) {
				logger.warn(`MCP display_chart: sandbox HTML failed: ${String(sandboxErr)}`, { source: 'tool' });
			}

			const chartOutput: ChartToolPayload = {
				embedUrl,
				chartEmbedId,
				block,
				queryId: query_id,
				title,
				chatId: validatedChatId ?? null,
			};
			return buildChartToolResult(chartOutput, { sandboxChartHtml });
		},
	});
}

function registerContextStoryTools(server: McpServer, ctx: McpContext): void {
	server.registerTool(
		'create_story',
		{
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
			_meta: uiToolMeta(STORY_APP_URI),
		},
		defineMcpHandler('create_story', ctx, async ({ title, content, query_data, chat_id }) => {
			const slug = generateSlug(title);
			const code = content ?? `# ${title}\n`;
			const story = chat_id
				? await createChatLinkedStory({ chatId: chat_id, slug, title, code, ctx })
				: await createStandaloneStory({ slug, title, code, ctx });

			if ('error' in story) {
				return { content: [{ type: 'text' as const, text: `Error: ${story.error}` }], isError: true };
			}

			await cacheStoryQueryData(story.id, code, query_data, chat_id, ctx.projectId);

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
		}),
	);

	server.registerTool(
		'update_story',
		{
			title: 'Update Story',
			description: UPDATE_STORY_DESCRIPTION,
			inputSchema: {
				story_id: z.string().describe('Story ID (from `list_stories` or a prior `create_story`).'),
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
			_meta: uiToolMeta(STORY_APP_URI),
		},
		defineMcpHandler('update_story', ctx, async ({ story_id, title, content, query_data, chat_id }) => {
			const story = await resolveStory(story_id, ctx);
			const latestVersion = await fetchLatestVersion(story);
			const newTitle = title ?? story.title;
			const newCode = content ?? latestVersion?.code ?? `# ${newTitle}\n`;
			const updated = await saveNewVersion(story, ctx, newTitle, newCode);
			const embedUrl = storyEmbedUrl(story.id, ctx.projectId);
			const effectiveChatId = chat_id ?? story.chatId ?? undefined;
			await cacheStoryQueryData(story.id, newCode, query_data, effectiveChatId, ctx.projectId);
			const output: StoryMcpToolPayload = {
				embedUrl,
				...updated,
				url: storyUrl(story),
				chatUrl: storyChatUrl(story),
			};
			return buildStoryMcpResultWithSandbox(output, ctx, newCode, effectiveChatId);
		}),
	);
}

async function resolveChartChatId(chatId: string | undefined, userId: string): Promise<string | undefined> {
	if (!chatId) {
		return undefined;
	}
	const ownerId = await chatQueries.getChatOwnerId(chatId);
	if (ownerId !== userId) {
		logger.warn(`MCP: chat_id ${chatId} does not belong to user ${userId}, ignoring`, { source: 'tool' });
		return undefined;
	}
	return chatId;
}

async function cacheStoryQueryData(
	storyId: string,
	code: string,
	queryData: StoryQueryDataMap | undefined,
	chatId: string | null | undefined,
	projectId: string,
): Promise<void> {
	const existingCache = await storyQueries.getStoryDataCacheByStoryId(storyId);
	const seededQueryData: StoryQueryDataMap = {
		...((existingCache?.queryData as StoryQueryDataMap | null) ?? {}),
		...(queryData ?? {}),
	};
	const resolvedQueryData = await resolveStoryQueryData(
		code,
		Object.keys(seededQueryData).length > 0 ? seededQueryData : null,
		projectId,
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

async function buildStoryMcpResultWithSandbox(
	output: StoryMcpToolPayload,
	ctx: McpContext,
	code: string | null | undefined,
	chatId?: string | null,
): Promise<ToolResult> {
	const storyId = String(output.id);
	const title = typeof output.title === 'string' ? output.title : 'Story';
	const openInNaoUrl =
		typeof output.url === 'string' ? output.url : storyUrl({ id: storyId, slug: '', chatId: chatId ?? null });

	let sandboxStoryHtml: string | null = null;
	if (code && code.trim().length > 0) {
		try {
			sandboxStoryHtml = await buildStorySandboxHtml({
				title,
				code,
				storyId,
				projectId: ctx.projectId,
				openInNaoUrl,
				chatId: chatId ?? (typeof output.chatId === 'string' ? output.chatId : null),
			});
		} catch (err) {
			logger.warn(`MCP story sandbox HTML failed: ${String(err)}`, { source: 'tool', context: { storyId } });
		}
	}
	return buildStoryToolResult(output, { sandboxStoryHtml });
}

async function resolveStory(storyId: string, ctx: McpContext): Promise<UserStoryRow> {
	const story = await storyQueries.getStoryByIdForUser(storyId, ctx.userId);
	if (!story) {
		throw new Error(`Story not found: ${storyId}`);
	}
	return story;
}

async function fetchLatestVersion(story: UserStoryRow) {
	return story.chatId
		? storyQueries.getLatestVersionByChatAndSlug(story.chatId, story.slug)
		: storyQueries.getLatestVersionByStoryId(story.id);
}

async function saveNewVersion(
	story: UserStoryRow,
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
