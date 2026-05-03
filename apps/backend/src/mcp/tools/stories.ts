import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { UserStoryRow } from '../../queries/story.queries';
import * as storyQueries from '../../queries/story.queries';
import { logger } from '../../utils/logger';
import type { McpContext } from '../logging';
import { withLogging } from '../logging';

export function registerStoryTools(server: McpServer, ctx: McpContext): void {
	server.registerTool(
		'list_stories',
		{
			title: 'List Stories',
			description: 'List analytics stories (dashboards/reports) in the current project.',
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
				const result = stories.map(({ id, title, createdAt, updatedAt, archivedAt }) => ({
					id,
					title,
					createdAt,
					updatedAt,
					archived: archivedAt !== null,
				}));
				return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], toolOutput: result };
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
			description: 'Retrieve a full story including its latest content/code.',
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
				};
				return {
					content: [{ type: 'text' as const, text: JSON.stringify(output) }],
					toolOutput: output,
				};
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
				'Create a new analytics story. Stories are markdown documents with embedded chart/table components rendered by the Nao UI.\n\nWorkflow for stories with charts:\n1. execute_sql → get rows + query_id\n2. build_chart → get a `<chart .../>` block string\n3. create_story → embed the block in `content`; pass SQL rows in `query_data`\n\nSupported blocks:\n- Charts: use `build_chart` to generate the correct `<chart>` block — do NOT write these manually.\n- Tables: `<table query_id="..." title="..." />`\n- Grids: `<grid cols="2">...blocks...</grid>` (1–4 columns)\n\nOmit `content` to create an empty story.',
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
			},
		},
		withLogging('create_story', ctx, async ({ title, content, query_data }) => {
			try {
				const slug = generateSlug(title);
				const code = content ?? `# ${title}\n`;

				const version = await storyQueries.createStandaloneVersion({
					userId: ctx.userId,
					projectId: ctx.projectId,
					slug,
					title,
					code,
					action: 'create',
					source: 'user',
				});

				const story = await storyQueries.getStandaloneStoryByUserAndSlug(ctx.userId, ctx.projectId, slug);
				if (query_data && story) {
					await storyQueries.upsertStoryDataCacheByStoryId(
						story.id,
						query_data as Record<string, { data: unknown[]; columns: string[] }>,
					);
				}
				const output = { id: story!.id, title: version.title, createdAt: story!.createdAt };
				return {
					content: [{ type: 'text' as const, text: JSON.stringify(output) }],
					toolOutput: output,
				};
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
				'Update a story title and/or content. Omit fields to keep their current values.\n\nWhen adding or replacing charts, use `build_chart` first to generate the correct `<chart>` block, then pass it in `content`. Include the SQL rows for any new query_ids in `query_data`.',
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
				if (query_data && !story.chatId) {
					const storyForCache =
						(await storyQueries.getStandaloneStoryByUserAndSlug(ctx.userId, ctx.projectId, story.slug)) ??
						story;
					const existingCache = await storyQueries.getStoryDataCacheByStoryId(storyForCache.id);
					const mergedQueryData = {
						...((existingCache?.queryData as Record<
							string,
							{ data: unknown[]; columns: string[] }
						> | null) ?? {}),
						...query_data,
					};
					await storyQueries.upsertStoryDataCacheByStoryId(
						storyForCache.id,
						mergedQueryData as Record<string, { data: unknown[]; columns: string[] }>,
					);
				}
				return { content: [{ type: 'text' as const, text: JSON.stringify(updated) }], toolOutput: updated };
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
					toolOutput: { id: story.id, archived: true },
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
					toolOutput: { id: story.id, deleted: true },
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

export function generateSlug(title: string): string {
	return (
		title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'untitled'
	);
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
		await storyQueries.createVersion({
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
