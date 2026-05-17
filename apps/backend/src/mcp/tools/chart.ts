import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { displayChart } from '@nao/shared/tools';
import { z } from 'zod';

import { formatChartBlock } from '../../utils/chart-block';
import { logger } from '../../utils/logger';
import { validateChartConfig } from '../../utils/validate-chart-config';
import type { McpContext } from '../logging';
import { withLogging } from '../logging';

const BUILD_CHART_DESCRIPTION =
	'Build a validated `<chart />` block for embedding in story content. ' +
	'Pass the `query_id` returned by `execute_sql` and chart configuration; returns a ready-to-paste block for `create_story` or `update_story` `content`.';

export function registerChartTools(server: McpServer, ctx: McpContext): void {
	server.registerTool(
		'build_chart',
		{
			title: 'Build Chart',
			description: BUILD_CHART_DESCRIPTION,
			inputSchema: displayChart.InputSchema,
			outputSchema: {
				success: z.boolean(),
				error: z.string().optional(),
				chart_block: z
					.string()
					.optional()
					.describe('The `<chart />` block to embed in story content. Present when success is true.'),
			},
		},
		withLogging('build_chart', ctx, async (input) => {
			try {
				const validation = validateChartConfig(input);
				if (!validation.success) {
					return {
						content: [{ type: 'text' as const, text: JSON.stringify(validation) }],
						isError: true,
					};
				}

				const chartBlock = formatChartBlock(input);
				const output = { success: true as const, chart_block: chartBlock };
				return { content: [{ type: 'text' as const, text: JSON.stringify(output) }] };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error(`MCP build_chart error: ${message}`, { source: 'tool', context: { userId: ctx.userId } });
				return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
			}
		}),
	);
}
