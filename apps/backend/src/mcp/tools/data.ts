import { randomUUID } from 'node:crypto';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildStoryChartBlock } from '@nao/shared';
import { displayChart, executeSql } from '@nao/shared/tools';
import zodV3 from 'zod/v3';

import displayChartTool from '../../agents/tools/display-chart';
import executeSqlTool from '../../agents/tools/execute-sql';
import * as chatQueries from '../../queries/chat.queries';
import { insertMcpChartEmbed } from '../../queries/mcp-chart-embed.queries';
import { getMcpQueryData, upsertMcpQueryData } from '../../queries/mcp-query-data.queries';
import { logger } from '../../utils/logger';
import { buildChartToolResult, type ChartToolPayload } from '../embed/embed-tool-result';
import { buildChartSandboxHtml } from '../embed/sandbox-html';
import { CHART_APP_URI, uiToolMeta } from '../embed/ui-resources';
import type { McpContext } from '../logging';
import { chartEmbedUrl, chatUrl } from '../urls';
import { registerAgentToolAsMcp } from './wrap-agent-tool';

type ExecuteSqlMcpInput = executeSql.Input & {
	chat_id?: string;
};

type DisplayChartMcpInput = displayChart.Input & {
	chat_id?: string;
};

const EXECUTE_SQL_INPUT_SCHEMA = executeSql.InputSchema.extend({
	chat_id: zodV3
		.string()
		.optional()
		.describe(
			'Optional chat UUID to associate with this query for chart embeds. Omit to use the chat from the last successful `ask_nao` in this MCP session. Pass an empty string to store no chat.',
		),
});

const EXECUTE_SQL_DESCRIPTION =
	'Run a SQL query against the connected data warehouse. Returns rows as JSON. The response includes `query_id` — pass it to `display_chart` or reference it in story `<table query_id="...">` blocks. Use ask_nao instead if you want Nao to write the SQL for you.\n\n' +
	'Optional `chat_id` (or the chat from the last `ask_nao` in this MCP session) is stored with the query so `display_chart` can show "Open in nao" to that chat even when the MCP client starts a new HTTP session between tools.';

const DISPLAY_CHART_INPUT_SCHEMA = displayChart.InputSchema.extend({
	chat_id: zodV3
		.string()
		.optional()
		.describe(
			'Optional chat UUID for the "Open in nao" embed button. Omit to use the chat stored with this `query_id` from `execute_sql`, then the last `ask_nao` chat in this MCP session. Pass an empty string for chart-only embed (no chat button).',
		),
});

const DISPLAY_CHART_DESCRIPTION =
	'Returns an interactive chart embed from a previous `execute_sql` result, and the Nao-compatible `<chart>` block to embed in story content. Always use this tool instead of writing `<chart>` blocks manually — it validates the chart config. Workflow: execute_sql → display_chart → create_story/update_story (pass the returned block in `content`; Nao caches rows for query_ids from execute_sql automatically).\n\n' +
	'The "Open in nao" chat link uses `chat_id` when set; otherwise the chat stored on the `query_id` row from `execute_sql` (or the last `ask_nao` in this MCP session). Pass `chat_id: ""` for a chart-only embed with no chat button.';

export function registerDataTools(server: McpServer, ctx: McpContext): void {
	registerAgentToolAsMcp<executeSql.Input, executeSql.Output, ExecuteSqlMcpInput>(server, ctx, {
		name: 'execute_sql',
		agentTool: executeSqlTool,
		title: 'Execute SQL',
		description: EXECUTE_SQL_DESCRIPTION,
		inputSchema: EXECUTE_SQL_INPUT_SCHEMA,
		mapInput: ({ chat_id: _chatId, ...input }) => input,
		formatResult: async ({ input, output, callLogId }) => {
			const queryId = output.id;
			const effectiveChatId = resolveEffectiveChatId(input.chat_id, ctx.sessionChatRef.lastChatId);
			const validatedSourceChat = await resolveChartChatId(effectiveChatId, ctx.userId);

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
		formatResult: async ({ input, output }) => {
			const { query_id, chart_type, x_axis_key, x_axis_type, series, title, chat_id } = input;
			if (!output.success) {
				return {
					content: [{ type: 'text' as const, text: output.error ?? 'Chart config is invalid.' }],
					isError: true,
				};
			}

			const block = buildStoryChartBlock({
				query_id,
				chart_type,
				x_axis_key,
				x_axis_type,
				series,
				title,
			});

			const queryData = await getMcpQueryData(query_id, ctx.projectId);
			const chatFallback = queryData?.sourceChatId?.trim() || ctx.sessionChatRef.lastChatId;
			const effectiveChatId = resolveEffectiveChatId(chat_id, chatFallback);
			const validatedChatId = await resolveChartChatId(effectiveChatId, ctx.userId);

			if (!queryData) {
				const chartOutput: ChartToolPayload = {
					embedUrl: null,
					chartEmbedId: null,
					block,
					queryId: query_id,
					title,
					chatId: validatedChatId ?? null,
				};
				return buildChartToolResult(chartOutput, {});
			}

			let chartEmbedId: string | null = null;
			let embedUrl: string | null = null;
			try {
				const id = randomUUID();
				const inserted = await insertMcpChartEmbed({
					chartEmbedId: id,
					queryId: query_id,
					projectId: ctx.projectId,
					chartConfig: {
						chartType: chart_type,
						xAxisKey: x_axis_key,
						xAxisType: x_axis_type,
						series,
						title,
					},
					sourceChatId: validatedChatId ?? null,
				});
				if (!inserted) {
					throw new Error(`no mcp_query_data row for query_id=${query_id} project_id=${ctx.projectId}`);
				}
				chartEmbedId = id;
				embedUrl = chartEmbedUrl(id, ctx.projectId);
			} catch (dbErr) {
				logger.warn(`MCP display_chart: chart embed persistence failed: ${String(dbErr)}`, {
					source: 'tool',
				});
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
				logger.warn(`MCP display_chart: sandbox HTML failed: ${String(sandboxErr)}`, {
					source: 'tool',
				});
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

function resolveEffectiveChatId(explicit: string | undefined, fallback: string | undefined): string | undefined {
	if (explicit === undefined) {
		return fallback;
	}
	return typeof explicit === 'string' && explicit.trim() ? explicit.trim() : undefined;
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
