import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { UserStoryRow } from '../../queries/story.queries';
import * as storyQueries from '../../queries/story.queries';
import { logger } from '../../utils/logger';
import { buildStoryToolResult, type StoryMcpToolPayload } from '../embed/embed-tool-result';
import { buildStorySandboxHtml } from '../embed/sandbox-html';
import { STORY_APP_URI, uiToolMeta } from '../embed/ui-resources';
import { defineMcpHandler, type McpContext, type ToolResult } from '../logging';
import { storyChatUrl, storyEmbedUrl, storyUrl } from '../urls';

const LIST_STORIES_DESCRIPTION =
	"List analytics stories in the current project. Returns each story's `id`, `title`, `url`, " +
	'`chatUrl` (null for standalone), `archived` flag, and timestamps.\n\n' +
	"USE WHEN: surfacing the project's existing dashboards/reports, or finding the `story_id` to " +
	'pass to `get_story` / `update_story` / `archive_story`.\n\n' +
	'Pass `archived: true` to include archived ones.';

const GET_STORY_DESCRIPTION =
	'Fetch a single story with its latest content (`code`), version metadata, `url`, `chatUrl`, ' +
	'and a rendered HTML embed.\n\n' +
	'USE WHEN: you need the actual markdown of a story (e.g. before calling `update_story`).\n' +
	'SKIP WHEN: you only need the list of stories → use `list_stories`.';

const ARCHIVE_STORY_DESCRIPTION =
	'Soft-delete a story — hides it from `list_stories` (unless called with `archived: true`) but ' +
	'keeps the data on disk.\n\n' +
	'USE WHEN: the user wants to remove a story but keep recovery possible.\n' +
	'SKIP WHEN: you need a permanent, irreversible delete → use `delete_story`.';

const DELETE_STORY_DESCRIPTION =
	'Permanently delete a story and all its versions. Cannot be undone.\n\n' +
	'USE WHEN: the user explicitly asks for a hard delete (compliance, mistaken story, sensitive data).\n' +
	'SKIP WHEN: a soft delete would do → use `archive_story` (recoverable).';

export function registerStoryManagementTools(server: McpServer, ctx: McpContext): void {
	server.registerTool(
		'list_stories',
		{
			title: 'List Stories',
			description: LIST_STORIES_DESCRIPTION,
			inputSchema: {
				limit: z
					.number()
					.int()
					.positive()
					.max(100)
					.optional()
					.default(20)
					.describe('Max stories to return (default 20, max 100).'),
				archived: z.boolean().optional().default(false).describe('Set to true to include archived stories.'),
			},
		},
		defineMcpHandler('list_stories', ctx, async ({ limit, archived }) => {
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
		}),
	);

	server.registerTool(
		'get_story',
		{
			title: 'Get Story',
			description: GET_STORY_DESCRIPTION,
			inputSchema: {
				story_id: z.string().describe('Story ID (typically from `list_stories`).'),
			},
			_meta: uiToolMeta(STORY_APP_URI),
		},
		defineMcpHandler('get_story', ctx, async ({ story_id }) => {
			const story = await resolveStory(story_id, ctx);
			const version = await fetchLatestVersion(story);

			const embedUrl = storyEmbedUrl(story.id, ctx.projectId);
			const output: StoryMcpToolPayload = {
				embedUrl,
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
			return buildStoryMcpResultWithSandbox(output, ctx, version?.code ?? null, story.chatId);
		}),
	);

	server.registerTool(
		'archive_story',
		{
			title: 'Archive Story',
			description: ARCHIVE_STORY_DESCRIPTION,
			inputSchema: {
				story_id: z.string().describe('Story ID (typically from `list_stories`).'),
			},
		},
		defineMcpHandler('archive_story', ctx, async ({ story_id }) => {
			const story = await resolveStory(story_id, ctx);
			await storyQueries.archiveByStoryId(story.id);
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ id: story.id, archived: true }) }],
			};
		}),
	);

	server.registerTool(
		'delete_story',
		{
			title: 'Delete Story',
			description: DELETE_STORY_DESCRIPTION,
			inputSchema: {
				story_id: z.string().describe('Story ID (typically from `list_stories`).'),
			},
		},
		defineMcpHandler('delete_story', ctx, async ({ story_id }) => {
			const story = await resolveStory(story_id, ctx);
			await storyQueries.deleteStory(story.id);
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ id: story.id, deleted: true }) }],
			};
		}),
	);
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
	const storyProjectId = await storyQueries.getStoryProjectId(storyId);
	if (storyProjectId !== ctx.projectId) {
		throw new Error(`Story not found: ${storyId}`);
	}
	return story;
}

async function fetchLatestVersion(story: UserStoryRow) {
	return story.chatId
		? storyQueries.getLatestVersionByChatAndSlug(story.chatId, story.slug)
		: storyQueries.getLatestVersionByStoryId(story.id);
}
