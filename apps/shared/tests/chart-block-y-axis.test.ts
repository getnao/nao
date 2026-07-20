import { describe, expect, it } from 'vitest';

import { buildStoryChartBlock } from '../src/chart-block';
import { parseChartBlock } from '../src/story-segments';

describe('chart block Y-axis range', () => {
	it('round-trips manual Y-axis bounds', () => {
		const block = buildStoryChartBlock({
			query_id: 'q1',
			chart_type: 'line',
			x_axis_key: 'month',
			x_axis_type: 'category',
			series: [{ data_key: 'revenue' }],
			y_axis_min: 1_000_000,
			y_axis_max: 1_050_000,
			title: 'Revenue',
		});

		const attrString = block.match(/^<chart\s+([\s\S]*?)\s*\/?>$/)?.[1];
		expect(attrString).toBeDefined();

		const parsed = parseChartBlock(attrString ?? '');
		expect(parsed?.yAxisMin).toBe(1_000_000);
		expect(parsed?.yAxisMax).toBe(1_050_000);
	});
});
