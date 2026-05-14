import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as chatQueries from '../../queries/chat.queries';
import type { UserStoryRow } from '../../queries/story.queries';
import * as storyQueries from '../../queries/story.queries';
import { pinQueryDataToChat, pinStoryMessageToChat } from '../../utils/chat-message-story';
import { logger } from '../../utils/logger';
import type { McpContext } from '../logging';
import { withLogging } from '../logging';
import { storyChatUrl, storyUrl } from '../urls';

export function registerStoryTools(server: McpServer, ctx: McpContext): void {
	server.registerTool(
		'list_stories',
		{
			title: 'List Stories',
			description:
				'List analytics stories (dashboards/reports) in the current project. Each story includes a `url` that opens the rendered story in the Nao UI, and a `chatUrl` that opens the underlying chat conversation (null for standalone stories).',
			inputSchema: {
				limit: z.number().optional().default(20).describe('Max stories to return (default 20, max 100)'),
				archived: z.boolean().optional().default(false).describe('Include archived stories'),
			},
		},
		withLogging('list_stories', ctx, async ({ limit, archived }) => {
			try {
				const stories = await storyQueries.listAllUserStoriesInProject(ctx.userId, ctx.projectId, {
					archived,
					limit,
				});
				const result = stories.map((story) => ({
					id: story.id,
					title: story.title,
					createdAt: story.createdAt,
					updatedAt: story.updatedAt,
					archived: story.archivedAt !== null,
					url: storyUrl(story),
					chatUrl: storyChatUrl(story),
				}));
				return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error(`MCP list_stories error: ${message}`, { source: 'tool', context: { userId: ctx.userId } });
				return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
			}
		}),
	);

	server.registerTool(
		'get_story',
		{
			title: 'Get Story',
			description:
				'Retrieve a full story including its latest content/code. Returns a `url` that opens the rendered story in the Nao UI, and a `chatUrl` that opens the underlying chat conversation (null for standalone stories).',
			inputSchema: {
				story_id: z.string().describe('The story ID to retrieve'),
			},
		},
		withLogging('get_story', ctx, async ({ story_id }) => {
			try {
				const story = await resolveStory(story_id, ctx);
				const version = await fetchLatestVersion(story);

				const output = {
					id: story.id,
					title: story.title,
					slug: story.slug,
					chatId: story.chatId,
					projectId: story.projectId,
					code: version?.code ?? null,
					version: version?.version ?? null,
					isLive: story.isLive,
					archived: story.archivedAt !== null,
					createdAt: story.createdAt,
					updatedAt: story.updatedAt,
					url: storyUrl(story),
					chatUrl: storyChatUrl(story),
				};
				return { content: [{ type: 'text' as const, text: JSON.stringify(output) }] };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error(`MCP get_story error: ${message}`, {
					source: 'tool',
					context: { story_id, userId: ctx.userId },
				});
				return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
			}
		}),
	);

	server.registerTool(
		'create_story',
		{
			title: 'Create Story',
			description:
				'Create a new analytics story. Stories are markdown documents with embedded chart/table components rendered by the Nao UI.\n\nWorkflow for stories with charts:\n1. `execute_sql` → get rows + `query_id`\n2. `create_story` → embed `<chart>` / `<table>` blocks in `content`; pass the SQL rows keyed by `query_id` in `query_data`\n\nSupported blocks (write them inline in `content`):\n- Charts: `<chart query_id="..." chart_type="bar|stacked_bar|line|area|stacked_area|pie|kpi_card|scatter|radar" x_axis_key="..." x_axis_type="date|number|category" series=\'[{"data_key":"...","color":"...","label":"..."}]\' title="..." />` — `series` is JSON inside single quotes; `x_axis_type` is optional; `kpi_card` and `pie` accept omitted/null `x_axis_type`.\n- Tables: `<table query_id="..." title="..." />`\n- Grids: `<grid cols="2">...blocks...</grid>` (1–4 columns)\n\nOmit `content` to create an empty story.\n\nPass `chat_id` to attach the story to an existing chat (e.g. one returned by `ask_nao`). Omit it to create a standalone story listed at the project level.\n\nReturns a `url` that opens the rendered story in the Nao UI and a `chatUrl` that opens the underlying chat (null for standalone stories) — surface the relevant link to the user as a clickable link in your reply.',
			inputSchema: {
				title: z.string().describe('Story title'),
				content: z
					.string()
					.optional()
					.describe(
						'Story content (Nao story markdown with <chart>, <table>, <grid> blocks). Omit to create empty.',
					),
				query_data: z
					.record(
						z.string(),
						z.object({ columns: z.array(z.string()), data: z.array(z.record(z.string(), z.unknown())) }),
					)
					.optional()
					.describe(
						'Query results keyed by query_id (query_id → { columns, data }). Required for stories with <chart> or <table> blocks so the Nao UI can render data.',
					),
				chat_id: z
					.string()
					.optional()
					.describe(
						'Attach the story to an existing chat (e.g. the chat ID returned by `ask_nao`). ' +
							'Omit to create a standalone story listed at the project level. ' +
							'When provided, the chat must belong to the current user.',
					),
			},
		},
		withLogging('create_story', ctx, async ({ title, content, query_data, chat_id }) => {
			try {
				const slug = generateSlug(title);
				const code = content ?? `# ${title}\n`;
				const story = chat_id
					? await createChatLinkedStory({ chatId: chat_id, slug, title, code, ctx })
					: await createStandaloneStory({ slug, title, code, ctx });

				if ('error' in story) {
					return { content: [{ type: 'text' as const, text: `Error: ${story.error}` }], isError: true };
				}

				if (query_data) {
					const typedQueryData = query_data as Record<string, { data: unknown[]; columns: string[] }>;
					await storyQueries.upsertStoryDataCacheByStoryId(story.id, typedQueryData);
					if (chat_id) {
						await pinQueryDataToChat(chat_id, typedQueryData);
					}
				}
				const storyForUrl = { id: story.id, slug: story.slug, chatId: story.chatId };
				const output = {
					id: story.id,
					title: story.title,
					createdAt: story.createdAt,
					url: storyUrl(storyForUrl),
					chatUrl: storyChatUrl(storyForUrl),
				};
				return { content: [{ type: 'text' as const, text: JSON.stringify(output) }] };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error(`MCP create_story error: ${message}`, {
					source: 'tool',
					context: { title, userId: ctx.userId },
				});
				return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
			}
		}),
	);

	server.registerTool(
		'update_story',
		{
			title: 'Update Story',
			description:
				'Update a story title and/or content. Omit fields to keep their current values.\n\nWhen adding or replacing charts, write the `<chart>` block directly in `content` (see `create_story` for the full chart syntax) and include the SQL rows for any new `query_id`s in `query_data`.\n\nReturns a `url` that opens the rendered story in the Nao UI and a `chatUrl` that opens the underlying chat (null for standalone stories) — surface the relevant link to the user as a clickable link in your reply.',
			inputSchema: {
				story_id: z.string().describe('The story ID to update'),
				title: z.string().optional().describe('New title (omit to keep current)'),
				content: z.string().optional().describe('New full content (Nao story markdown). Omit to keep current.'),
				query_data: z
					.record(
						z.string(),
						z.object({ columns: z.array(z.string()), data: z.array(z.record(z.string(), z.unknown())) }),
					)
					.optional()
					.describe(
						'Query results keyed by query_id (query_id → { columns, data }). Required for any new <chart> or <table> blocks added in this update.',
					),
			},
		},
		withLogging('update_story', ctx, async ({ story_id, title, content, query_data }) => {
			try {
				const story = await resolveStory(story_id, ctx);
				const latestVersion = await fetchLatestVersion(story);
				const newTitle = title ?? story.title;
				const newCode = content ?? latestVersion?.code ?? `# ${newTitle}\n`;
				const updated = await saveNewVersion(story, ctx, newTitle, newCode);
				const output = { ...updated, url: storyUrl(story), chatUrl: storyChatUrl(story) };
				if (query_data) {
					const typedQueryData = query_data as Record<string, { data: unknown[]; columns: string[] }>;
					if (story.chatId) {
						await pinQueryDataToChat(story.chatId, typedQueryData);
					} else {
						const storyForCache =
							(await storyQueries.getStandaloneStoryByUserAndSlug(
								ctx.userId,
								ctx.projectId,
								story.slug,
							)) ?? story;
						const existingCache = await storyQueries.getStoryDataCacheByStoryId(storyForCache.id);
						const mergedQueryData = {
							...((existingCache?.queryData as Record<
								string,
								{ data: unknown[]; columns: string[] }
							> | null) ?? {}),
							...typedQueryData,
						};
						await storyQueries.upsertStoryDataCacheByStoryId(storyForCache.id, mergedQueryData);
					}
				}
				return { content: [{ type: 'text' as const, text: JSON.stringify(output) }] };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error(`MCP update_story error: ${message}`, {
					source: 'tool',
					context: { story_id, userId: ctx.userId },
				});
				return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
			}
		}),
	);

	server.registerTool(
		'archive_story',
		{
			title: 'Archive Story',
			description: 'Soft-delete a story by archiving it. The story can be restored later.',
			inputSchema: {
				story_id: z.string().describe('The story ID to archive'),
			},
		},
		withLogging('archive_story', ctx, async ({ story_id }) => {
			try {
				const story = await resolveStory(story_id, ctx);
				await storyQueries.archiveByStoryId(story.id);
				return {
					content: [{ type: 'text' as const, text: JSON.stringify({ id: story.id, archived: true }) }],
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error(`MCP archive_story error: ${message}`, {
					source: 'tool',
					context: { story_id, userId: ctx.userId },
				});
				return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
			}
		}),
	);

	server.registerTool(
		'delete_story',
		{
			title: 'Delete Story',
			description:
				'Permanently delete a story and all its versions. This cannot be undone. Use archive_story if you want a recoverable soft-delete.',
			inputSchema: {
				story_id: z.string().describe('The story ID to permanently delete'),
			},
		},
		withLogging('delete_story', ctx, async ({ story_id }) => {
			try {
				const story = await resolveStory(story_id, ctx);
				await storyQueries.deleteStory(story.id);
				return {
					content: [{ type: 'text' as const, text: JSON.stringify({ id: story.id, deleted: true }) }],
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error(`MCP delete_story error: ${message}`, {
					source: 'tool',
					context: { story_id, userId: ctx.userId },
				});
				return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
			}
		}),
	);
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
			error: `A story with title "${args.title}" already exists. Pick a different title or use update_story to modify the existing one.`,
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
			error: `A story with title "${args.title}" already exists in this chat. Pick a different title or use update_story to modify the existing one.`,
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
		return { id: updated!.id, title: updated!.title, updatedAt: updated!.updatedAt };
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
	return { id: updated!.id, title: updated!.title, updatedAt: updated!.updatedAt };
}
