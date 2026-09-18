import { describe, expect, it } from 'vitest';
import { z } from 'zod';

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
		expect(displayChart.isBuiltinChartType('horizontal_bar')).toBe(true);
		expect(displayChart.isBuiltinChartType('horizontal_bar_100')).toBe(true);
		expect(displayChart.isBuiltinChartType('bubble')).toBe(false);
	});

	it('defaults data labels on only for horizontal bars', () => {
		expect(displayChart.resolveShowDataLabels('horizontal_bar', undefined)).toBe(true);
		expect(displayChart.resolveShowDataLabels('horizontal_bar_100', undefined)).toBe(false);
		expect(displayChart.resolveShowDataLabels('bar', undefined)).toBe(false);
		expect(displayChart.resolveShowDataLabels('horizontal_bar', false)).toBe(false);
		expect(displayChart.resolveShowDataLabels('horizontal_bar_100', true)).toBe(true);
		expect(displayChart.resolveShowDataLabels('bar', true)).toBe(true);
	});
});

describe('display chart MCP input', () => {
	const input = {
		query_id: 'query-1',
		series: [{ data_key: 'revenue' }],
		title: 'Revenue',
	};

	it.each(['x_axis_key', 'x_axis_type'] as const)('requires %s for non-KPI charts', (field) => {
		const chart = {
			...input,
			chart_type: 'bar',
			x_axis_key: 'month',
			x_axis_type: 'category',
		};
		delete chart[field];

		expect(displayChart.DisplayChartMcpInputShapeSchema.safeParse(chart).success).toBe(false);
	});

	it('allows KPI cards to omit axis fields', () => {
		expect(
			displayChart.DisplayChartMcpInputShapeSchema.safeParse({
				...input,
				chart_type: 'kpi_card',
			}).success,
		).toBe(true);
	});

	it('advertises the conditional axis requirements in JSON Schema', () => {
		const schema = z.toJSONSchema(displayChart.DisplayChartMcpInputShapeSchema) as {
			oneOf: { properties: { chart_type: { const?: string } }; required?: string[] }[];
		};
		const kpiSchema = schema.oneOf.find((option) => option.properties.chart_type.const === 'kpi_card');
		const chartSchema = schema.oneOf.find((option) => option !== kpiSchema);

		expect(kpiSchema?.required).not.toContain('x_axis_key');
		expect(chartSchema?.required).toContain('x_axis_key');
	});
});
