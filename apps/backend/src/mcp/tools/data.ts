import crypto from 'node:crypto';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { executeQuery } from '../../agents/tools/execute-sql';
import { getEnvVars, retrieveProjectById } from '../../queries/project.queries';
import { hasFeature, LICENSE_FEATURES } from '../../services/license.service';
import { getAzureAccessTokenForUser } from '../../services/microsoft-auth.service';
import { logger } from '../../utils/logger';
import type { McpContext } from '../logging';
import { withLogging } from '../logging';

export function registerDataTools(server: McpServer, ctx: McpContext): void {
	server.registerTool(
		'execute_sql',
		{
			title: 'Execute SQL',
			description:
				'Run a SQL query against the connected data warehouse. Returns rows as JSON. The response includes a `query_id` — pass it to `build_chart` or reference it in story `<table query_id="...">` blocks. Use ask_nao instead if you want Nao to write the SQL for you.',
			inputSchema: {
				sql: z.string().describe('The SQL query to execute'),
				limit: z.number().optional().default(100).describe('Max rows to return (default 100, max 1000)'),
			},
		},
		withLogging('execute_sql', ctx, async ({ sql, limit }) => {
			try {
				const project = await retrieveProjectById(ctx.projectId);
				const envVars = await getEnvVars(ctx.projectId);
				const azureAccessToken = (await hasFeature(LICENSE_FEATURES.sso))
					? await getAzureAccessTokenForUser(ctx.userId)
					: null;
				const cappedLimit = Math.min(limit, 1000);

				const result = await executeQuery(
					{ sql_query: sql },
					{
						projectFolder: project.path!,
						chatId: '',
						agentSettings: null,
						envVars,
						azureAccessToken,
						queryResults: new Map(),
					},
				);

				const rows = result.data.slice(0, cappedLimit);
				const queryId = `query_${crypto.randomUUID().slice(0, 8)}`;
				const output = { query_id: queryId, columns: result.columns, row_count: rows.length, data: rows };
				return {
					content: [{ type: 'text' as const, text: JSON.stringify(output) }],
					toolOutput: output,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error(`MCP execute_sql error: ${message}`, {
					source: 'tool',
					context: { sql, userId: ctx.userId },
				});
				return { content: [{ type: 'text' as const, text: `SQL execution error: ${message}` }], isError: true };
			}
		}),
	);

	server.registerTool(
		'build_chart',
		{
			title: 'Build Chart',
			description:
				'Generate a Nao-compatible `<chart>` block to embed in story content. Always use this tool instead of writing `<chart>` blocks manually — it ensures the correct syntax for the Nao UI renderer. Workflow: execute_sql → build_chart → create_story/update_story (pass the returned block in `content` and the SQL rows in `query_data`).',
			inputSchema: {
				query_id: z.string().describe('The query_id returned by execute_sql.'),
				chart_type: z
					.enum(['bar', 'stacked_bar', 'line', 'area', 'stacked_area', 'pie', 'kpi_card', 'scatter', 'radar'])
					.describe('Type of chart to render.'),
				x_axis_key: z.string().describe('Column name for the X-axis / category labels.'),
				x_axis_type: z
					.enum(['date', 'number', 'category'])
					.nullable()
					.describe(
						'Use "date" for YYYY-MM-DD values, "category" for labels/periods, "number" for numeric axes. Use null if unsure.',
					),
				series: z
					.array(
						z.object({
							data_key: z.string().describe('Column name from SQL result to plot.'),
							color: z.string().optional().describe('CSS color (defaults to theme colors).'),
							label: z.string().optional().describe('Label to display in the legend.'),
						}),
					)
					.min(1)
					.describe('Columns to plot. Each entry needs at least a data_key (column name from SQL result).'),
				title: z
					.string()
					.describe('Concise descriptive chart title. Do not include the chart type in the title.'),
			},
		},
		withLogging('build_chart', ctx, async ({ query_id, chart_type, x_axis_key, x_axis_type, series, title }) => {
			const typedSeries = series as Array<{ data_key: string; color?: string; label?: string }>;
			const block = buildChartBlock(query_id, chart_type, x_axis_key, x_axis_type, typedSeries, title);
			return { content: [{ type: 'text' as const, text: block }], toolOutput: { block } };
		}),
	);
}

function buildChartBlock(
	queryId: string,
	chartType: string,
	xAxisKey: string,
	xAxisType: string | null,
	series: Array<{ data_key: string; color?: string; label?: string }>,
	title: string,
): string {
	const escapedTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
	const xAxisTypeAttr = xAxisType ? ` x_axis_type="${xAxisType}"` : '';
	return `<chart query_id="${queryId}" chart_type="${chartType}" x_axis_key="${xAxisKey}"${xAxisTypeAttr} series='${JSON.stringify(series)}' title="${escapedTitle}" />`;
}
