import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import {
	buildChart,
	type BuildChartProps,
	computeKpiComparison,
	computeValueAxisWidth,
	describePreviousPeriod,
} from '../src/chart-builder';
import { CHART_FONT_STACK } from '../src/chart-fonts';
import { formatChartValue } from '../src/chart-values';
import { type ChartElement, findChartElement } from './helpers/chart-elements';

const LONG_CATEGORY = 'A very long category';

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
		expect(computeValueAxisWidth([1, 10], undefined, true)).toBe(76);
		expect(computeValueAxisWidth([], undefined, true)).toBe(60);
		expect(computeValueAxisWidth([0, 980_000], currencyFormat, true)).toBe(122);
		expect(computeValueAxisWidth([0, Number.MAX_SAFE_INTEGER], currencyFormat, true)).toBe(160);
	});
});

describe('buildChart', () => {
	it.each([
		{ chartType: 'stacked_bar', bounds: 'stack totals', domain: [0, 110] },
		{ chartType: 'bar', bounds: 'individual values', domain: [0, 60] },
		{ chartType: 'stacked_area', bounds: 'stack totals', domain: [0, 110] },
		{ chartType: 'area', bounds: 'individual values', domain: [0, 60] },
	] as const)('uses $bounds for $chartType fallback bounds', ({ chartType, domain }) => {
		const yAxis = findChartElement(
			buildChart({
				data: [{ name: 'A', costs: 60, revenue: 50 }],
				chartType,
				xAxisKey: 'name',
				xAxisType: 'category',
				series: [{ data_key: 'costs' }, { data_key: 'revenue' }],
				yAxisMin: 0,
			}),
			'YAxis',
		);

		expect(yAxis?.props.domain).toEqual(domain);
	});

	it('uses the chart-specific prefix for area gradient ids and fills', () => {
		const firstChart = buildCategoryChart({ chartType: 'area', gradientIdPrefix: 'a-' });
		const secondChart = buildCategoryChart({ chartType: 'area', gradientIdPrefix: 'b-' });

		expect(getGradient(firstChart)?.props.id).toBe('a-grad-0');
		expect(findChartElement(firstChart, 'Area')?.props.fill).toBe('url(#a-grad-0)');
		expect(getGradient(secondChart)?.props.id).toBe('b-grad-0');
		expect(getGradient(firstChart)?.props.id).not.toBe(getGradient(secondChart)?.props.id);
	});

	it('shows and angles every compact category label with a custom tick font size', () => {
		const xAxis = findChartElement(
			buildCategoryChart({
				data: [{ name: LONG_CATEGORY, value: 10 }],
				compactXAxis: true,
				xAxisTickFontSize: 9,
				labelFormatter: (value) => value,
			}),
			'XAxis',
		);

		expect(xAxis?.props.interval).toBe(0);
		expect(xAxis?.props.angle).toBe(-35);
		expect(xAxis?.props.textAnchor).toBe('end');
		expect(xAxis?.props.height).toBe(56);
		expect(xAxis?.props.tick).toEqual({ fontSize: 9, fontFamily: CHART_FONT_STACK });
		expect(xAxis?.props.tickFormatter(LONG_CATEGORY)).toBe(LONG_CATEGORY);
	});

	it('reserves the fixed category axis height when labels are not compact', () => {
		const xAxis = findChartElement(buildCategoryChart({ data: [{ name: 'Category', value: 10 }] }), 'XAxis');

		expect(xAxis?.props.height).toBe(56);
		expect(xAxis?.props.angle).toBeUndefined();
	});

	it('truncates compact category labels to the configured character limit', () => {
		const xAxis = findChartElement(
			buildCategoryChart({
				data: [{ name: LONG_CATEGORY, value: 10 }],
				compactXAxis: true,
				xAxisMaxLabelChars: 6,
				labelFormatter: (value) => value,
			}),
			'XAxis',
		);

		expect(xAxis?.props.tickFormatter(LONG_CATEGORY)).toBe('A ver…');
	});
});

describe('computeKpiComparison', () => {
	const rows = yearOverYear(100, 120);

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
		expect(computeKpiComparison(yearOverYear(100, 80), 'period', 'value', 'percentage')).toMatchObject({
			valueText: '20%',
			direction: 'down',
			colored: true,
		});
	});

	it('returns null for percentage change from zero', () => {
		expect(computeKpiComparison(yearOverYear(0, 20), 'period', 'value', 'percentage')).toBeNull();
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
		expect(computeKpiComparison(yearOverYear(100, 100), 'period', 'value', 'percentage')).toMatchObject({
			valueText: '0%',
			direction: 'flat',
			colored: true,
		});
	});
});

describe('describePreviousPeriod', () => {
	it.each([
		{ gap: 'yearly date gaps', previous: '2023-01-01', current: '2024-01-01', expected: 'last year' },
		{ gap: 'monthly date gaps', previous: '2024-01-01', current: '2024-02-01', expected: 'last month' },
		{ gap: 'month-only date gaps', previous: '2024-01', current: '2024-02', expected: 'last month' },
		{
			gap: 'space-separated datetimes',
			previous: '2023-01-01 00:00:00',
			current: '2024-01-01 00:00:00',
			expected: 'last year',
		},
		{ gap: 'weekly date gaps', previous: '2024-01-01', current: '2024-01-08', expected: 'last week' },
		{ gap: 'a one-day gap', previous: '2024-01-01', current: '2024-01-02', expected: 'yesterday' },
		{ gap: 'non-date categories', previous: 'Q1', current: 'Q2', expected: 'previous period' },
	])('describes $gap as $expected', ({ previous, current, expected }) => {
		expect(describePreviousPeriod(previous, current)).toBe(expected);
	});
});

function buildCategoryChart(overrides: Partial<BuildChartProps> = {}): ReactElement {
	return buildChart({
		data: [{ name: 'A', value: 10 }],
		chartType: 'bar',
		xAxisKey: 'name',
		xAxisType: 'category',
		series: [{ data_key: 'value' }],
		...overrides,
	});
}

function yearOverYear(previous: number, current: number) {
	return [
		{ period: '2023-01-01', value: previous },
		{ period: '2024-01-01', value: current },
	];
}

function getGradient(chart: ReactElement): ChartElement | undefined {
	const definitions = findChartElement(chart, 'defs');
	return definitions && findChartElement(definitions, 'linearGradient');
}
