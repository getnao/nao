import { describe, expect, it } from 'vitest';

import { isBuiltinChartType, resolveShowDataLabels } from '../src/chart-types';
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
		expect(isBuiltinChartType('line')).toBe(true);
		expect(isBuiltinChartType('horizontal_bar')).toBe(true);
		expect(isBuiltinChartType('horizontal_bar_100')).toBe(true);
		expect(isBuiltinChartType('bubble')).toBe(false);
	});

	it('defaults data labels on only for horizontal bars', () => {
		expect(resolveShowDataLabels('horizontal_bar', undefined)).toBe(true);
		expect(resolveShowDataLabels('horizontal_bar_100', undefined)).toBe(false);
		expect(resolveShowDataLabels('bar', undefined)).toBe(false);
		expect(resolveShowDataLabels('horizontal_bar', false)).toBe(false);
		expect(resolveShowDataLabels('horizontal_bar_100', true)).toBe(true);
		expect(resolveShowDataLabels('bar', true)).toBe(true);
	});
});
