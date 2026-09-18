import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { buildChart, computeKpiComparison, computeValueAxisWidth, describePreviousPeriod } from '../src/chart-builder';
import { formatChartValue } from '../src/chart-values';

describe('formatChartValue', () => {
	it('uses en-US formatting by default', () => {
		expect(formatChartValue(1234)).toBe('1,234');
	});

	it('formats currency and places the prefix after the negative sign', () => {
		expect(
			formatChartValue(-1200, {
				d3_format: '.2s',
				prefix: '$',
			}),
		).toBe('-$1.2K');
	});

	it('adds a percentage suffix without multiplying the value', () => {
		expect(formatChartValue(42.5, { d3_format: '.1f', suffix: '%' })).toBe('42.5%');
	});

	it('maps SI billions to financial notation by default', () => {
		expect(formatChartValue(2_500_000_000, { d3_format: '.2s' })).toBe('2.5B');
	});

	it('keeps SI notation when requested', () => {
		expect(formatChartValue(2_500_000_000, { d3_format: '.2s', compact: 'si' })).toBe('2.5G');
	});

	it('falls back gracefully for an invalid d3 specifier', () => {
		expect(formatChartValue(1234, { d3_format: 'invalid', prefix: '$' }, { compact: true })).toBe('$1,234');
	});
});

describe('computeValueAxisWidth', () => {
	it('keeps short labels near the minimum width', () => {
		expect(computeValueAxisWidth([1, 10])).toBe(36);
		expect(computeValueAxisWidth([])).toBe(40);
	});

	it('expands for formatted currency labels and clamps extreme widths', () => {
		const valueFormat = { d3_format: ',.0f', prefix: '$' };
		const plainWidth = computeValueAxisWidth([1, 10]);
		const currencyWidth = computeValueAxisWidth([0, 980_000], valueFormat);

		expect(currencyWidth).toBeGreaterThan(plainWidth);
		expect(currencyWidth).toBe(82);
		expect(computeValueAxisWidth([0, Number.MAX_SAFE_INTEGER], valueFormat)).toBe(120);
	});

	it('reserves extra width for a rotated axis title when hasLabel is set', () => {
		const currencyFormat = { d3_format: ',.0f', prefix: '$' };
		expect(computeValueAxisWidth([1, 10], undefined, true)).toBe(56);
		expect(computeValueAxisWidth([], undefined, true)).toBe(60);
		expect(computeValueAxisWidth([0, 980_000], currencyFormat, true)).toBe(102);
		expect(computeValueAxisWidth([0, Number.MAX_SAFE_INTEGER], currencyFormat, true)).toBe(140);
	});
});

describe('buildChart', () => {
	it('uses stack totals for stacked bar fallback bounds', () => {
		const yAxis = getYAxis(
			buildChart({
				data: [{ name: 'A', costs: 60, revenue: 50 }],
				chartType: 'stacked_bar',
				xAxisKey: 'name',
				xAxisType: 'category',
				series: [{ data_key: 'costs' }, { data_key: 'revenue' }],
				yAxisMin: 0,
			}),
		);

		expect(yAxis?.props.domain).toEqual([0, 110]);
	});

	it('uses individual values for grouped bar fallback bounds', () => {
		const yAxis = getYAxis(
			buildChart({
				data: [{ name: 'A', costs: 60, revenue: 50 }],
				chartType: 'bar',
				xAxisKey: 'name',
				xAxisType: 'category',
				series: [{ data_key: 'costs' }, { data_key: 'revenue' }],
				yAxisMin: 0,
			}),
		);

		expect(yAxis?.props.domain).toEqual([0, 60]);
	});

	it('uses stack totals for stacked area fallback bounds', () => {
		const yAxis = getYAxis(
			buildChart({
				data: [{ name: 'A', costs: 60, revenue: 50 }],
				chartType: 'stacked_area',
				xAxisKey: 'name',
				xAxisType: 'category',
				series: [{ data_key: 'costs' }, { data_key: 'revenue' }],
				yAxisMin: 0,
			}),
		);

		expect(yAxis?.props.domain).toEqual([0, 110]);
	});

	it('uses individual values for plain area fallback bounds', () => {
		const yAxis = getYAxis(
			buildChart({
				data: [{ name: 'A', costs: 60, revenue: 50 }],
				chartType: 'area',
				xAxisKey: 'name',
				xAxisType: 'category',
				series: [{ data_key: 'costs' }, { data_key: 'revenue' }],
				yAxisMin: 0,
			}),
		);

		expect(yAxis?.props.domain).toEqual([0, 60]);
	});

	it('uses the chart-specific prefix for area gradient ids and fills', () => {
		const firstChart = buildChart({
			data: [{ name: 'A', value: 10 }],
			chartType: 'area',
			xAxisKey: 'name',
			xAxisType: 'category',
			series: [{ data_key: 'value' }],
			gradientIdPrefix: 'a-',
		});
		const secondChart = buildChart({
			data: [{ name: 'A', value: 10 }],
			chartType: 'area',
			xAxisKey: 'name',
			xAxisType: 'category',
			series: [{ data_key: 'value' }],
			gradientIdPrefix: 'b-',
		});

		expect(getGradient(firstChart)?.props.id).toBe('a-grad-0');
		expect(getArea(firstChart)?.props.fill).toBe('url(#a-grad-0)');
		expect(getGradient(secondChart)?.props.id).toBe('b-grad-0');
		expect(getGradient(firstChart)?.props.id).not.toBe(getGradient(secondChart)?.props.id);
	});

	it('shows and angles every compact category label with a custom tick font size', () => {
		const xAxis = getXAxis(
			buildChart({
				data: [{ name: 'A very long category', value: 10 }],
				chartType: 'bar',
				xAxisKey: 'name',
				xAxisType: 'category',
				series: [{ data_key: 'value' }],
				compactXAxis: true,
				xAxisTickFontSize: 9,
				labelFormatter: (value) => value,
			}),
		);

		expect(xAxis?.props.interval).toBe(0);
		expect(xAxis?.props.angle).toBe(-35);
		expect(xAxis?.props.textAnchor).toBe('end');
		expect(xAxis?.props.height).toBe(56);
		expect(xAxis?.props.tick).toEqual({ fontSize: 9 });
		expect(xAxis?.props.tickFormatter('A very long category')).toBe('A very long category');
	});

	it('reserves the fixed category axis height when labels are not compact', () => {
		const xAxis = getXAxis(
			buildChart({
				data: [{ name: 'Category', value: 10 }],
				chartType: 'bar',
				xAxisKey: 'name',
				xAxisType: 'category',
				series: [{ data_key: 'value' }],
			}),
		);

		expect(xAxis?.props.height).toBe(56);
		expect(xAxis?.props.angle).toBeUndefined();
	});

	it('does not truncate compact category labels without a character limit', () => {
		const xAxis = getXAxis(
			buildChart({
				data: [{ name: 'A very long category', value: 10 }],
				chartType: 'bar',
				xAxisKey: 'name',
				xAxisType: 'category',
				series: [{ data_key: 'value' }],
				compactXAxis: true,
				labelFormatter: (value) => value,
			}),
		);

		expect(xAxis?.props.tickFormatter('A very long category')).toBe('A very long category');
	});

	it('truncates compact category labels to the configured character limit', () => {
		const xAxis = getXAxis(
			buildChart({
				data: [{ name: 'A very long category', value: 10 }],
				chartType: 'bar',
				xAxisKey: 'name',
				xAxisType: 'category',
				series: [{ data_key: 'value' }],
				compactXAxis: true,
				xAxisMaxLabelChars: 6,
				labelFormatter: (value) => value,
			}),
		);

		expect(xAxis?.props.tickFormatter('A very long category')).toBe('A ver…');
	});
});

describe('computeKpiComparison', () => {
	const rows = [
		{ period: '2023-01-01', value: 100 },
		{ period: '2024-01-01', value: 120 },
	];

	it('returns null without a previous row', () => {
		expect(computeKpiComparison([rows[0]], 'period', 'value', 'percentage')).toBeNull();
	});

	it('returns null when comparison is disabled', () => {
		expect(computeKpiComparison(rows, 'period', 'value', 'none')).toBeNull();
		expect(computeKpiComparison(rows, 'period', 'value', undefined)).toBeNull();
	});

	it('computes a percentage increase', () => {
		expect(computeKpiComparison(rows, 'period', 'value', 'percentage')).toEqual({
			valueText: '20%',
			direction: 'up',
			colored: true,
			periodLabel: 'last year',
		});
	});

	it('infers the period label from a date column when xAxisKey is empty', () => {
		expect(
			computeKpiComparison(
				[
					{ month: '2024-01-01', revenue: 100 },
					{ month: '2024-02-01', revenue: 150 },
				],
				'',
				'revenue',
				'percentage',
			),
		).toMatchObject({ valueText: '50%', direction: 'up', periodLabel: 'last month' });
	});

	it('computes a percentage decrease as an unsigned magnitude', () => {
		expect(
			computeKpiComparison(
				[
					{ period: '2023-01-01', value: 100 },
					{ period: '2024-01-01', value: 80 },
				],
				'period',
				'value',
				'percentage',
			),
		).toMatchObject({ valueText: '20%', direction: 'down', colored: true });
	});

	it('returns null for percentage change from zero', () => {
		expect(
			computeKpiComparison(
				[
					{ period: '2023-01-01', value: 0 },
					{ period: '2024-01-01', value: 20 },
				],
				'period',
				'value',
				'percentage',
			),
		).toBeNull();
	});

	it('computes variation as a colored absolute delta', () => {
		expect(computeKpiComparison(rows, 'period', 'value', 'variation')).toMatchObject({
			valueText: '20',
			direction: 'up',
			colored: true,
		});
	});

	it('computes absolute mode without color', () => {
		expect(computeKpiComparison(rows, 'period', 'value', 'absolute')).toMatchObject({
			valueText: '20',
			direction: 'up',
			colored: false,
		});
	});

	it('marks an unchanged value as flat', () => {
		expect(
			computeKpiComparison(
				[
					{ period: '2023-01-01', value: 100 },
					{ period: '2024-01-01', value: 100 },
				],
				'period',
				'value',
				'percentage',
			),
		).toMatchObject({ valueText: '0%', direction: 'flat', colored: true });
	});
});

describe('describePreviousPeriod', () => {
	it('describes yearly date gaps', () => {
		expect(describePreviousPeriod('2023-01-01', '2024-01-01')).toBe('last year');
	});

	it('describes monthly date gaps', () => {
		expect(describePreviousPeriod('2024-01-01', '2024-02-01')).toBe('last month');
	});

	it('describes month-only date gaps', () => {
		expect(describePreviousPeriod('2024-01', '2024-02')).toBe('last month');
	});

	it('handles space-separated datetimes', () => {
		expect(describePreviousPeriod('2023-01-01 00:00:00', '2024-01-01 00:00:00')).toBe('last year');
	});

	it('describes weekly date gaps', () => {
		expect(describePreviousPeriod('2024-01-01', '2024-01-08')).toBe('last week');
	});

	it('describes a one-day gap as yesterday', () => {
		expect(describePreviousPeriod('2024-01-01', '2024-01-02')).toBe('yesterday');
	});

	it('falls back for non-date categories', () => {
		expect(describePreviousPeriod('Q1', 'Q2')).toBe('previous period');
	});
});

function getYAxis(chart: ReactElement): ReactElement | undefined {
	return flattenChildren(chart.props.children).find((child) => child.type.displayName === 'YAxis');
}

function getXAxis(chart: ReactElement): ReactElement | undefined {
	return flattenChildren(chart.props.children).find((child) => child.type.displayName === 'XAxis');
}

function getGradient(chart: ReactElement): ReactElement | undefined {
	const definitions = flattenChildren(chart.props.children).find((child) => child.type === 'defs');
	return flattenChildren(definitions?.props.children).find((child) => child.type === 'linearGradient');
}

function getArea(chart: ReactElement): ReactElement | undefined {
	return flattenChildren(chart.props.children).find((child) => child.type.displayName === 'Area');
}

function flattenChildren(children: unknown): ReactElement[] {
	if (Array.isArray(children)) {
		return children.flatMap(flattenChildren);
	}
	if (isReactElement(children)) {
		return [children];
	}
	return [];
}

function isReactElement(value: unknown): value is ReactElement {
	return typeof value === 'object' && value !== null && 'props' in value && 'type' in value;
}
