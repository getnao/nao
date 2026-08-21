import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/chat.queries', () => ({
	getQueryResultByQueryId: vi.fn(async () => null),
}));

import displayChartTool from '../src/agents/tools/display-chart';
import type { ToolContext } from '../src/types/tools';

describe('display_chart execute', () => {
	it('rejects progress bars with more than one series', async () => {
		const context = {
			generatedArtifacts: { charts: [], maps: [], stories: [] },
		} as unknown as ToolContext;
		const output = await displayChartTool.execute!(
			{
				query_id: 'query-1',
				chart_type: 'progress_bar',
				x_axis_key: 'category',
				x_axis_type: 'category',
				series: [{ data_key: 'revenue' }, { data_key: 'cost' }],
				title: 'Revenue and cost',
			},
			{
				experimental_context: context,
			} as Parameters<NonNullable<typeof displayChartTool.execute>>[1],
		);

		expect(output).toMatchObject({
			success: false,
			error: 'Progress bar charts require exactly one series.',
		});
		expect(context.generatedArtifacts.charts).toHaveLength(0);
	});
});
