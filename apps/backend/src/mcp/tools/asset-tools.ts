import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { displayChart } from '@nao/shared/tools';
import { z } from 'zod';
import zodV3 from 'zod/v3';

import displayChartTool from '../../agents/tools/display-chart';
import * as storyQueries from '../../queries/story.queries';
import { buildChartToolResult, type StoryMcpToolPayload } from '../embed/embed-tool-result';
import { CHART_APP_URI, STORY_APP_URI, uiToolMeta } from '../embed/ui-resources';
import type { McpContext, ToolResult } from '../logging';
import { storyChatUrl, storyEmbedUrl, storyUrl } from '../urls';
import {
	buildChartEmbedFromArtifact,
	buildStoryMcpResultWithSandbox,
	fetchLatestStoryVersion,
	resolveChartChatId,
	resolveStory,
} from './helpers';
import { registerAgentToolAsMcp, registerMcpTool } from './register-mcp-tool';

const DISPLAY_CHART_DESCRIPTION =
	'Render an interactive chart embed from a previously executed query.\n\n' +
	'USE WHEN: you have a `query_id` — either fresh from `execute_sql` or returned by a prior ' +
	'`ask_nao` in its `queries` array — and want a shareable embed URL or a `<chart>` block to drop ' +
	'into a story.\n' +
	"SKIP WHEN: you don't have data yet → run `execute_sql` first, or `ask_nao` to let nao handle " +
	'both the SQL and the chart in one shot. Also skip when you just called `create_story` or ' +
	'`update_story` — the story embed already renders all its `<chart>` blocks; calling ' +
	'`display_chart` again would duplicate them.\n\n' +
	'`x_axis_key` and every `series[].data_key` MUST be a column name from the query result — ' +
	'i.e. one of `execute_sql.columns` or `ask_nao.queries[].columns` (same contract on both). ' +
	'Passing a key that does not exist in the data will be rejected with the list of valid columns.\n\n' +
	'nao auto-resolves the rows from the MCP cache or from any chat in this project you own — no ' +
	"need to track which chat produced the query. Pass `chat_id` only to wire the embed's " +
	'`Open in nao` button to a specific chat (e.g. `chatId` from `ask_nao`).\n\n' +
	'Returns the embed URL, the `<chart>` block ready to paste into a story, and a sandbox HTML preview.';

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
	'SKIP WHEN: you only need the list of stories → use `list_stories`.\n\n' +
	'`story_id` must be the UUID (returned by `list_stories.id` or `ask_nao.stories[].id`), not the kebab-case slug.';

const ARCHIVE_STORY_DESCRIPTION =
	'Soft-delete a story — hides it from `list_stories` (unless called with `archived: true`) but ' +
	'keeps the data on disk.\n\n' +
	'USE WHEN: the user wants to remove a story but keep recovery possible.\n' +
	'SKIP WHEN: you need a permanent, irreversible delete → use `delete_story`.\n\n' +
	'`story_id` must be the UUID (from `list_stories` or `ask_nao.stories[].id`), not the slug.';

const DELETE_STORY_DESCRIPTION =
	'Permanently delete a story and all its versions. Cannot be undone.\n\n' +
	'USE WHEN: the user explicitly asks for a hard delete (compliance, mistaken story, sensitive data).\n' +
	'SKIP WHEN: a soft delete would do → use `archive_story` (recoverable).\n\n' +
	'`story_id` must be the UUID (from `list_stories` or `ask_nao.stories[].id`), not the slug.';

type DisplayChartMcpInput = displayChart.Input & { chat_id?: string };

const DISPLAY_CHART_INPUT_SCHEMA = displayChart.InputSchema.extend({
	chat_id: zodV3
		.string()
		.optional()
		.describe(
			'Optional chat UUID (e.g. `chatId` from `ask_nao`) to anchor the embed to a chat. ' +
				"Used for the embed's `Open in nao` link and to track the source chat; " +
				'nao resolves the rows automatically across the project even without it.',
		),
});

export function registerAssetTools(server: McpServer, ctx: McpContext): void {
	registerDisplayChart(server, ctx);
	registerStoryManagementTools(server, ctx);
}

function registerDisplayChart(server: McpServer, ctx: McpContext): void {
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

			const validatedChatId = await resolveChartChatId(chat_id, ctx);
			const result = await buildChartEmbedFromArtifact(
				{ query_id, chart_type, x_axis_key, x_axis_type, series, title },
				ctx,
				{ chatId: validatedChatId ?? null, callLogId },
			);

			if (!result) {
				return buildMissingQueryDataResult({ queryId: query_id, chatIdInput: chat_id, validatedChatId });
			}

			if ('keyError' in result) {
				return buildInvalidKeysResult(result.keyError);
			}

			return buildChartToolResult(result.payload, { sandboxChartHtml: result.sandboxChartHtml });
		},
	});
}

function buildMissingQueryDataResult(args: {
	queryId: string;
	chatIdInput: string | undefined;
	validatedChatId: string | undefined;
}): ToolResult {
	const { queryId, chatIdInput, validatedChatId } = args;
	const hint =
		chatIdInput && !validatedChatId
			? `\`chat_id\` "${chatIdInput}" is not accessible to you (not found, wrong project, or owned by another user). `
			: 'Run `execute_sql` (or `ask_nao`) again to produce a fresh `query_id`. ';
	const text = `query_id "${queryId}" has no matching execute_sql result available to you in this project. ${hint}`;
	return {
		content: [{ type: 'text' as const, text }],
		isError: true,
	};
}

function buildInvalidKeysResult(error: { invalidKeys: string[]; availableColumns: string[] }): ToolResult {
	const invalid = error.invalidKeys.map((k) => `\`${k}\``).join(', ');
	const available = error.availableColumns.map((k) => `\`${k}\``).join(', ');
	const text = `display_chart rejected: key(s) ${invalid} not found in query result. Available columns: ${available}. Retry with one of those.`;
	return {
		content: [{ type: 'text' as const, text }],
		isError: true,
	};
}

function registerStoryManagementTools(server: McpServer, ctx: McpContext): void {
	registerMcpTool(server, ctx, {
		name: 'list_stories',
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
		handler: async ({ limit, archived }) => {
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
		},
	});

	registerMcpTool(server, ctx, {
		name: 'get_story',
		title: 'Get Story',
		description: GET_STORY_DESCRIPTION,
		inputSchema: {
			story_id: z
				.string()
				.describe('Story UUID (from `list_stories.id` or `ask_nao.stories[].id`). Not the slug.'),
		},
		_meta: uiToolMeta(STORY_APP_URI),
		handler: async ({ story_id }) => {
			const story = await resolveStory(story_id, ctx);
			const version = await fetchLatestStoryVersion(story);

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
		},
	});

	registerMcpTool(server, ctx, {
		name: 'archive_story',
		title: 'Archive Story',
		description: ARCHIVE_STORY_DESCRIPTION,
		inputSchema: {
			story_id: z
				.string()
				.describe('Story UUID (from `list_stories.id` or `ask_nao.stories[].id`). Not the slug.'),
		},
		handler: async ({ story_id }) => {
			const story = await resolveStory(story_id, ctx);
			await storyQueries.archiveByStoryId(story.id);
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ id: story.id, archived: true }) }],
			};
		},
	});

	registerMcpTool(server, ctx, {
		name: 'delete_story',
		title: 'Delete Story',
		description: DELETE_STORY_DESCRIPTION,
		inputSchema: {
			story_id: z
				.string()
				.describe('Story UUID (from `list_stories.id` or `ask_nao.stories[].id`). Not the slug.'),
		},
		handler: async ({ story_id }) => {
			const story = await resolveStory(story_id, ctx);
			await storyQueries.deleteStory(story.id);
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ id: story.id, deleted: true }) }],
			};
		},
	});
}
