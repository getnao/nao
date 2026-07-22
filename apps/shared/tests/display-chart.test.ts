import { describe, expect, it } from 'vitest';

import { displayChart } from '../src/tools';

const chartInput = {
	query_id: 'query-1',
	chart_type: 'bubble',
	x_axis_key: 'revenue',
	x_axis_type: 'number' as const,
	series: [{ data_key: 'orders' }],
	title: 'Revenue and orders',
};

describe('display chart custom types', () => {
	it('accepts a valid custom chart type', () => {
		expect(displayChart.InputSchema.safeParse(chartInput).success).toBe(true);
	});

	it('rejects unsafe custom chart names', () => {
		expect(displayChart.InputSchema.safeParse({ ...chartInput, chart_type: '../bubble' }).success).toBe(false);
		expect(displayChart.InputSchema.safeParse({ ...chartInput, chart_type: 'Bubble Chart' }).success).toBe(false);
	});

	it('distinguishes built-in and custom chart types', () => {
		expect(displayChart.isBuiltinChartType('line')).toBe(true);
		expect(displayChart.isBuiltinChartType('bubble')).toBe(false);
	});
});
