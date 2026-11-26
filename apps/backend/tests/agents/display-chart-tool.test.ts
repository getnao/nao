import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/queries/chat.queries', () => ({
	getQueryResultByQueryId: vi.fn(async () => null),
}));

import displayChartTool from '../../src/agents/tools/display-chart';
import { createToolContext, executeTool } from '../helpers/tool-context';

describe('display_chart execute', () => {
	it('accepts horizontal bars with multiple series', async () => {
		const context = createToolContext();
		const output = await executeTool(
			displayChartTool,
			{
				query_id: 'query-1',
				chart_type: 'horizontal_bar',
				x_axis_key: 'category',
				x_axis_type: 'category',
				series: [{ data_key: 'revenue' }, { data_key: 'cost' }],
				title: 'Revenue and cost',
			},
			context,
		);

		expect(output).toMatchObject({ success: true });
		expect(context.generatedArtifacts.charts).toHaveLength(1);
	});

	it('requires multiple series for normalized horizontal bars', async () => {
		const context = createToolContext();
		const output = await executeTool(
			displayChartTool,
			{
				query_id: 'query-1',
				chart_type: 'horizontal_bar_100',
				x_axis_key: 'category',
				x_axis_type: 'category',
				series: [{ data_key: 'revenue' }],
				title: 'Revenue share',
			},
			context,
		);

		expect(output).toMatchObject({
			success: false,
			error: expect.stringContaining('requires at least two series'),
		});
		expect(context.generatedArtifacts.charts).toHaveLength(0);
	});

	it.each([
		{ chart_type: 'stacked_area_100', expected: { success: true } },
		{
			chart_type: 'pie',
			expected: { success: false, error: expect.stringContaining('do not support breakdown_key') },
		},
		{
			chart_type: 'scatter',
			expected: { success: false, error: expect.stringContaining('do not support breakdown_key') },
		},
	] as const)('checks breakdown_key on $chart_type charts', async ({ chart_type, expected }) => {
		const output = await executeTool(
			displayChartTool,
			{
				query_id: 'query-1',
				chart_type,
				x_axis_key: 'week',
				x_axis_type: 'date',
				series: [{ data_key: 'domains' }],
				breakdown_key: 'nao_version',
				title: 'Domains by version',
			},
			createToolContext(),
		);

		expect(output).toMatchObject(expected);
	});
});
