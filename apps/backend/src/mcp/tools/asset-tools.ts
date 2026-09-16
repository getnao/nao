import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CustomBoundarySet } from '@nao/shared';
import { displayChart, displayMap } from '@nao/shared/tools';
import { z } from 'zod';
import zodV3 from 'zod/v3';

import displayChartTool from '../../agents/tools/display-chart';
import * as storyQueries from '../../queries/story.queries';
import {
	buildAgentRenderedChartText,
	CHART_DATA_MODE_DISPLAY_CHART_ADDENDUM,
	CHART_DATA_MODE_FALLBACK_NOTE,
} from '../chart-data-mode';
import {
	buildChartToolResult,
	buildMapToolResult,
	STORY_OUTPUT_SCHEMA,
	type StoryMcpToolPayload,
} from '../embed/embed-tool-result';
import { CHART_APP_URI, MAP_APP_URI, STORY_APP_URI, uiToolMeta } from '../embed/ui-resources';
import type { McpContext, ToolResult } from '../logging';
import { storyChatUrl, storyEmbedUrl, storyUrl } from '../urls';
import {
	buildChartEmbedFromArtifact,
	buildMapEmbedFromArtifact,
	buildStoryMcpResultWithSandbox,
	fetchLatestStoryVersion,
	resolveChartChatId,
	resolveStory,
} from './helpers';
import { registerAgentToolAsMcp, registerMcpTool } from './register-mcp-tool';
import { STORY_LIST_ITEM_SCHEMA, toStoryListItem } from './story-list-item';

const DISPLAY_CHART_DESCRIPTION =
	'Render an interactive chart embed from a previously executed query.\n\n' +
	'USE WHEN: you have a `query_id` — either fresh from `execute_sql` or returned by a prior ' +
	'`ask_nao` in its `queries` array — and want a shareable embed URL or a `<chart>` block to drop ' +
	'into a story.\n' +
	"SKIP WHEN: you don't have data yet → run `execute_sql` first, or `ask_nao` to let nao handle " +
	'both the SQL and the chart in one shot. Also skip when you just called `create_story` or ' +
	'`update_story` — the story embed already renders all its `<chart>` blocks; calling ' +
	'`display_chart` again would duplicate them.';

const DISPLAY_CHART_DATA_MODE_DESCRIPTION = DISPLAY_CHART_DESCRIPTION + CHART_DATA_MODE_DISPLAY_CHART_ADDENDUM;

const LIST_STORIES_DESCRIPTION = 'List nao stories.';

const GET_STORY_DESCRIPTION =
	'Fetch a single story with its latest content (`code`), version metadata, `url`, `chatUrl`, ' +
	'and a rendered HTML embed.\n\n' +
	"Useful when you need the actual markdown of a story to get it's latest content and metadata.\n\n" +
	'`story_id` must be the UUID (returned by `list_stories.id` or `ask_nao.stories[].id`), not the kebab-case slug.';

const ARCHIVE_STORY_DESCRIPTION =
	'Archive (soft-delete) a story: it stops appearing in `list_stories` and `ask_nao` results, but ' +
	'the data and version history are preserved and the user can restore it from the nao UI.\n\n' +
	'USE WHEN: the user wants to remove a story but keep recovery possible.\n' +
	'SKIP WHEN: you need a permanent, irreversible delete → use `delete_story`.\n\n' +
	'`story_id` must be the UUID (from `list_stories` or `ask_nao.stories[].id`), not the slug.';

const DELETE_STORY_DESCRIPTION =
	'Permanently delete a story and all its versions. Cannot be undone.\n\n' +
	'CONFIRM FIRST: ask the user to confirm the permanent deletion and suggest `archive_story` first. ' +
	'Do not call this tool on ambiguous intent.\n' +
	'USE WHEN: the user explicitly asks for a hard delete (compliance, mistaken story, sensitive data).\n';

const STORY_ID_INPUT = z
	.string()
	.describe('Story UUID (from `list_stories.id` or `ask_nao.stories[].id`). Not the slug.');

type DisplayChartMcpInput = displayChart.ChartInput & { chat_id?: string };

const DISPLAY_MAP_DESCRIPTION =
	'Render an interactive map embed from a previously executed query.\n\n' +
	'USE WHEN: you have a `query_id` from `execute_sql` and want a shareable map embed URL or a ' +
	'`<map>` block to drop into a story. Supports point maps, scatter/bubble maps, and choropleth maps.\n' +
	"SKIP WHEN: you don't have data yet → run `execute_sql` first to get geographic data. " +
	'Also skip when you just called `create_story` or `update_story` — the story embed already ' +
	'renders all its `<map>` blocks; calling `display_map` again would duplicate them.';

export function registerAssetTools(server: McpServer, ctx: McpContext, customBoundaries?: CustomBoundarySet[]): void {
	registerDisplayChart(server, ctx);
	registerDisplayMap(server, ctx, customBoundaries ?? []);
	registerStoryManagementTools(server, ctx);
}

function registerDisplayChart(server: McpServer, ctx: McpContext): void {
	registerAgentToolAsMcp<displayChart.Input, displayChart.Output, DisplayChartMcpInput>(server, ctx, {
		name: 'display_chart',
		agentTool: displayChartTool,
		title: 'Display Chart',
		description: ctx.chartDataMode ? DISPLAY_CHART_DATA_MODE_DESCRIPTION : DISPLAY_CHART_DESCRIPTION,
		inputSchema: displayChart.ChartInputObjectSchema.extend({
			chat_id: zodV3
				.string()
				.optional()
				.describe(
					'Optional chat UUID (e.g. `chatId` from `ask_nao`) to anchor the embed to a chat. ' +
						"Used for the embed's `Open in nao` link and to track the source chat; " +
						'nao resolves the rows automatically across the project even without it.',
				),
		}),
		outputSchema: {
			queryId: z
				.string()
				.describe('`query_id` the chart was built from. Reuse for further `display_chart` calls.'),
			title: z.string().describe('Chart title.'),
			block: z
				.string()
				.describe('`<chart query_id="..." />` markdown block — drop into a story `content` for embedding.'),
			embedUrl: z
				.url()
				.nullable()
				.describe('Sandboxed embed URL for the chart, or null if the chart could not be persisted.'),
			chartEmbedId: z
				.string()
				.nullable()
				.describe('UUID of the persisted chart embed (null if persistence failed).'),
			chatId: z.string().nullable().describe('Source chat UUID this chart is anchored to, if any.'),
			sandboxChartHtml: z
				.string()
				.optional()
				.describe('Self-contained HTML for inline rendering when small enough; omitted for large charts.'),
		},
		_meta: uiToolMeta(CHART_APP_URI),
		mapInput: ({ chat_id: _chatId, ...input }) => input,
		resolveChatId: (input) => input.chat_id ?? null,
		formatResult: async ({ input, output, callLogId }) => {
			const { chat_id, ...artifact } = input;
			if (!output.success) {
				return {
					content: [{ type: 'text' as const, text: output.error ?? 'Chart config is invalid.' }],
					isError: true,
				};
			}

			const validatedChatId = await resolveChartChatId(chat_id, ctx);
			const result = await buildChartEmbedFromArtifact(artifact, ctx, {
				chatId: validatedChatId ?? null,
				callLogId,
			});

			if (!result) {
				return buildMissingQueryDataResult({
					queryId: artifact.query_id,
					chatIdInput: chat_id,
					validatedChatId,
				});
			}

			if ('keyError' in result) {
				return buildInvalidKeysResult(result.keyError);
			}

			const toolResult = buildChartToolResult(result.payload, { sandboxChartHtml: result.sandboxChartHtml });

			if (ctx.chartDataMode) {
				const chartText = buildAgentRenderedChartText({
					config: artifact,
					columns: result.queryData.columns,
					rows: result.queryData.data,
				});
				toolResult.content.unshift({ type: 'text', text: chartText ?? CHART_DATA_MODE_FALLBACK_NOTE });
			}

			return toolResult;
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

function registerDisplayMap(server: McpServer, ctx: McpContext, customBoundaries: CustomBoundarySet[]): void {
	registerMcpTool(server, ctx, {
		name: 'display_map',
		title: 'Display Map',
		description: DISPLAY_MAP_DESCRIPTION,
		inputSchema: displayMap.buildInputObjectSchema(customBoundaries).extend({
			chat_id: zodV3
				.string()
				.optional()
				.describe(
					'Optional chat UUID (e.g. `chatId` from `ask_nao`) to anchor the embed to a chat. ' +
						"Used for the embed's `Open in nao` link and to track the source chat; " +
						'nao resolves the rows automatically across the project even without it.',
				),
		}),
		outputSchema: {
			queryId: z.string().describe('`query_id` the map was built from. Reuse for further `display_map` calls.'),
			title: z.string().describe('Map title.'),
			block: z
				.string()
				.describe('`<map query_id="..." />` markdown block — drop into a story `content` for embedding.'),
			embedUrl: z
				.url()
				.nullable()
				.describe('Sandboxed embed URL for the map, or null if the map could not be persisted.'),
			mapEmbedId: z.string().nullable().describe('UUID of the persisted map embed (null if persistence failed).'),
			chatId: z.string().nullable().describe('Source chat UUID this map is anchored to, if any.'),
			sandboxMapHtml: z
				.string()
				.optional()
				.describe('Self-contained HTML for inline rendering when small enough; omitted for large maps.'),
		},
		_meta: uiToolMeta(MAP_APP_URI),
		handler: async (rawInput, _extra, callLogId) => {
			const { chat_id, ...mapInput } = rawInput as displayMap.Input & { chat_id?: string };
			const validatedChatId = await resolveChartChatId(chat_id, ctx);

			const result = await buildMapEmbedFromArtifact(mapInput as displayMap.Input, ctx, {
				chatId: validatedChatId ?? null,
				callLogId,
				customBoundaries,
			});

			if (!result) {
				return buildMissingQueryDataResult({
					queryId: (rawInput as { query_id: string }).query_id,
					chatIdInput: chat_id,
					validatedChatId,
				});
			}

			if ('keyError' in result) {
				return buildMapInvalidKeysResult(result.keyError);
			}

			if ('validationError' in result) {
				return {
					content: [{ type: 'text' as const, text: `display_map rejected: ${result.validationError}` }],
					isError: true,
				};
			}

			return buildMapToolResult(result.payload, { sandboxMapHtml: result.sandboxMapHtml });
		},
	});
}

function buildMapInvalidKeysResult(error: { invalidKeys: string[]; availableColumns: string[] }): ToolResult {
	const available = error.availableColumns.map((k) => `\`${k}\``).join(', ');
	const text =
		error.invalidKeys.length > 0
			? `display_map rejected: key(s) ${error.invalidKeys.map((k) => `\`${k}\``).join(', ')} not found in query result. Available columns: ${available}. Retry with one of those.`
			: `display_map rejected: column not found in query result. Available columns: ${available}.`;
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
		outputSchema: {
			stories: z
				.array(STORY_LIST_ITEM_SCHEMA)
				.describe('Stories visible to the current user in this project, newest first.'),
		},
		handler: async ({ limit, archived }) => {
			const stories = await storyQueries.listAllUserStoriesInProject(ctx.userId, ctx.projectId, {
				archived,
				limit,
			});
			const result = stories.map((story) =>
				toStoryListItem(story, { url: storyUrl(story), chatUrl: storyChatUrl(story) }),
			);
			const output = { stories: result };
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(output) }],
				structuredContent: output,
			};
		},
	});

	registerMcpTool(server, ctx, {
		name: 'get_story',
		title: 'Get Story',
		description: GET_STORY_DESCRIPTION,
		inputSchema: { story_id: STORY_ID_INPUT },
		outputSchema: STORY_OUTPUT_SCHEMA,
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
		inputSchema: { story_id: STORY_ID_INPUT },
		outputSchema: {
			id: z.string().describe('Story UUID that was archived.'),
			archived: z.literal(true).describe('Always `true` on success — the story is now archived.'),
		},
		handler: async ({ story_id }) => {
			const story = await resolveStory(story_id, ctx);
			await storyQueries.archiveByStoryId(story.id);
			const output = { id: story.id, archived: true as const };
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(output) }],
				structuredContent: output,
			};
		},
	});

	registerMcpTool(server, ctx, {
		name: 'delete_story',
		title: 'Delete Story',
		description: DELETE_STORY_DESCRIPTION,
		inputSchema: { story_id: STORY_ID_INPUT },
		outputSchema: {
			id: z.string().describe('Story UUID that was permanently deleted.'),
			deleted: z.literal(true).describe('Always `true` on success — the story and all versions are gone.'),
		},
		handler: async ({ story_id }) => {
			const story = await resolveStory(story_id, ctx);
			await storyQueries.deleteStory(story.id);
			const output = { id: story.id, deleted: true as const };
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(output) }],
				structuredContent: output,
			};
		},
	});
}
