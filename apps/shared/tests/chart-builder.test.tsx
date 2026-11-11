import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
	buildChart,
	type BuildChartProps,
	computeKpiComparison,
	computeValueAxisWidth,
	describePreviousPeriod,
	KpiCard,
} from '../src/chart-builder';
import { CHART_FONT_STACK } from '../src/chart-fonts';
import { ChartConfigProvider, ChartLegendContent } from '../src/chart-tooltip';
import { BUILTIN_CHART_TYPES } from '../src/chart-types';
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

	it('renders line charts without an area fill', () => {
		const chart = buildChart({
			data: [{ name: 'A', value: 10 }],
			chartType: 'line',
			xAxisKey: 'name',
			xAxisType: 'category',
			series: [{ data_key: 'value' }],
		});

		expect(getGradient(chart)).toBeUndefined();
		expect(findChartElement(chart, 'Area')?.props.fill).toBe('none');
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
		expect(xAxis?.props.tick).toEqual({ fontSize: 9, fontFamily: CHART_FONT_STACK, 'data-nao-part': 'axis-tick' });
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

const MONTHLY_ROWS = [
	{ month: '2018-01', revenue: 10 },
	{ month: '2018-02', revenue: 26 },
];
const TWO_SERIES = [{ data_key: 'revenue' }, { data_key: 'cost' }];
const TWO_SERIES_ROWS = MONTHLY_ROWS.map((row) => ({ ...row, cost: 3 }));
const DATA_POINT = 'data-nao-part="data-point"';

describe('chart parts', () => {
	it('marks the title, axis names and ticks', () => {
		const markup = render(monthlyConfig({ title: 'Revenue', xAxisLabel: 'Month', yAxisLabel: 'Amount' }));

		for (const kind of ['title', 'x-axis', 'y-axis', 'axis-tick']) {
			expect(markup).toContain(`data-nao-part="${kind}"`);
		}
	});

	it('marks a data point with its series, category and formatted value', () => {
		const markup = render(monthlyConfig({ series: [{ data_key: 'revenue', value_format: { prefix: '$' } }] }));

		expect(markup).toMatch(
			/data-nao-part="data-point"[^>]*data-nao-part-series="revenue"[^>]*data-nao-part-category="2018-02"[^>]*data-nao-part-value="\$26"/,
		);
	});

	it.each([
		['bar', {}, 2],
		['stacked_bar', { series: TWO_SERIES, data: TWO_SERIES_ROWS }, 4],
		['horizontal_bar', { series: TWO_SERIES, data: TWO_SERIES_ROWS }, 4],
		['pie', {}, 2],
		['line', {}, 2],
		['area', {}, 2],
		[
			'mixed',
			{
				series: [{ data_key: 'revenue', series_type: 'line' as const }, { data_key: 'cost' }],
				data: TWO_SERIES_ROWS,
			},
			4,
		],
	] as const)('marks one data point per row and series of a %s chart', (chartType, overrides, count) => {
		expect(countMatches(render(monthlyConfig({ chartType, ...overrides })), DATA_POINT)).toBe(count);
	});

	it('leaves the bars and dots of a large chart unmarked', () => {
		const data = Array.from({ length: 1001 }, (_, index) => ({ month: `m${index}`, revenue: index, cost: 1 }));
		const series = [{ data_key: 'revenue', series_type: 'line' as const }, { data_key: 'cost' }];

		const markup = render(monthlyConfig({ chartType: 'mixed', series, data }));

		expect(markup).not.toContain(DATA_POINT);
		expect(markup).not.toContain('fill="transparent"');
	});

	it('keeps the horizontal bar track out of the data points', () => {
		const tracks = render(monthlyConfig({ chartType: 'horizontal_bar' })).match(
			/<path[^>]*recharts-bar-background-rectangle[^>]*>/g,
		);

		expect(tracks).toHaveLength(2);
		expect(tracks?.join('')).not.toContain('data-nao-part');
	});

	it('marks the diverging horizontal bar baseline', () => {
		const data = [
			{ month: 'A', revenue: -5 },
			{ month: 'B', revenue: 8 },
		];

		expect(render(monthlyConfig({ chartType: 'horizontal_bar', data }))).toContain(
			'data-nao-part="reference-line"',
		);
	});

	it('draws transparent dots only where a value exists, without key warnings', () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		const data = [
			{ month: 'a', revenue: 10 },
			{ month: 'b', revenue: null },
			{ month: 'c', revenue: 5 },
		];

		const dots = render(monthlyConfig({ chartType: 'line', data })).match(/<circle[^>]*>/g) ?? [];
		const keyWarnings = errors.mock.calls.filter(([message]) => String(message).includes('unique "key"'));
		errors.mockRestore();

		expect(dots).toHaveLength(2);
		expect(dots.join('')).not.toContain('data-nao-part-category="b"');
		expect(dots.every((dot) => dot.includes('fill="transparent"') && dot.includes('r="4"'))).toBe(true);
		expect(keyWarnings).toHaveLength(0);
	});

	it('marks the hovered dot of line and area series without changing its look', () => {
		const series = [
			{ data_key: 'revenue', series_type: 'line' as const },
			{ data_key: 'cost', series_type: 'area' as const },
		];
		const renderers = [
			monthlyConfig({ chartType: 'line' }),
			monthlyConfig({ chartType: 'area' }),
			monthlyConfig({ chartType: 'mixed', series }),
		].flatMap((config) => collectActiveDots(buildChart(config)));
		const props = {
			cx: 40,
			cy: 60,
			r: 4,
			fill: '#123456',
			strokeWidth: 2,
			stroke: '#fff',
			payload: MONTHLY_ROWS[1],
		};

		expect(renderers).toHaveLength(4);
		for (const renderActiveDot of renderers) {
			const markup = renderToStaticMarkup(<svg>{renderActiveDot(props)}</svg>);
			expect(markup).toContain('data-nao-part-category="2018-02"');
			expect(markup).toMatch(/cx="40" cy="60" r="4" fill="#123456" stroke="#fff" stroke-width="2"/);
		}
		expect(renderToStaticMarkup(<svg>{renderers[0]({ ...props, cy: Number.NaN })}</svg>)).not.toContain('<circle');
	});

	it('renders every chart type to static markup', () => {
		for (const chartType of BUILTIN_CHART_TYPES) {
			expect(() => render(monthlyConfig({ chartType, title: 'Chart' }))).not.toThrow();
		}
	});

	it('marks a legend entry with its series and label', () => {
		const markup = renderToStaticMarkup(
			<ChartConfigProvider config={{ revenue: { label: 'Revenue', color: '#000' } }}>
				<ChartLegendContent payload={[{ value: 'revenue', dataKey: 'revenue', color: '#000' }]} />
			</ChartConfigProvider>,
		);

		expect(markup).toMatch(
			/data-nao-part="legend-item"[^>]*data-nao-part-label="Revenue"[^>]*data-nao-part-series="revenue"/,
		);
	});

	it('marks the KPI name, value and comparison', () => {
		const markup = renderToStaticMarkup(
			<KpiCard
				value={1103}
				displayName='Total orders'
				comparison={{ direction: 'up', colored: true, valueText: '+12%', periodLabel: 'last month' }}
			/>,
		);

		expect(markup).toMatch(/data-nao-part="kpi-name"[^>]*data-nao-part-label="Total orders"/);
		expect(markup).toMatch(/data-nao-part="kpi-value"[^>]*data-nao-part-value="1,103"/);
		expect(markup).toContain('data-nao-part="kpi-comparison"');
	});
});

function render(config: BuildChartProps): string {
	return renderToStaticMarkup(cloneElement(buildChart(config), { width: 600, height: 300 }));
}

function monthlyConfig(overrides: Partial<BuildChartProps> = {}): BuildChartProps {
	return {
		data: MONTHLY_ROWS,
		chartType: 'bar',
		xAxisKey: 'month',
		xAxisType: 'category',
		series: [{ data_key: 'revenue' }],
		...overrides,
	};
}

function countMatches(markup: string, pattern: string): number {
	return markup.split(pattern).length - 1;
}

type ActiveDotRenderer = (props: Record<string, unknown>) => ReactNode;

function collectActiveDots(node: ReactNode): ActiveDotRenderer[] {
	return Children.toArray(node).flatMap((child) => {
		if (!isValidElement<{ children?: ReactNode; activeDot?: unknown }>(child)) {
			return [];
		}
		const own = typeof child.props.activeDot === 'function' ? [child.props.activeDot as ActiveDotRenderer] : [];
		return [...own, ...collectActiveDots(child.props.children)];
	});
}
