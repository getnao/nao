import type { displayChart } from '@nao/shared/tools';
import { describe, expect, it } from 'vitest';

import { renderChartToSvg } from '../../src/components/generate-chart';

type ChartConfig = Parameters<typeof renderChartToSvg>[0]['config'];

const MONTHLY_ROWS = [
	{ month: 'Jan', revenue: 1000, orders: 12 },
	{ month: 'Feb', revenue: 1500, orders: 18 },
];

const SERIES_LABEL = 'Total revenue';

const COUNTRIES = [
	'China',
	'India',
	'Turkey',
	'United States',
	'Egypt',
	'Italy',
	'Spain',
	'Mexico',
	'Brazil',
	'Nigeria',
];

describe('renderChartToSvg (combo)', () => {
	it('renders mixed bar and line series', () => {
		const svg = renderCombo([
			{ data_key: 'revenue', series_type: 'bar' },
			{ data_key: 'orders', series_type: 'line' },
		]);
		expect(svg).toContain('recharts-bar');
		expect(svg).toContain('recharts-line');
	});

	it('draws a second Y-axis when a series uses the right axis', () => {
		const svg = renderCombo([
			{ data_key: 'revenue', series_type: 'bar', y_axis: 'left' },
			{ data_key: 'orders', series_type: 'line', y_axis: 'right' },
		]);
		expect(countYAxes(svg)).toBe(2);
	});

	it('keeps a single Y-axis when every series stays on the left', () => {
		const svg = renderCombo([
			{ data_key: 'revenue', series_type: 'bar', y_axis: 'left' },
			{ data_key: 'orders', series_type: 'line', y_axis: 'left' },
		]);
		expect(countYAxes(svg)).toBe(1);
	});

	it('renders independent axis labels', () => {
		const svg = renderCombo(
			[
				{ data_key: 'revenue', series_type: 'bar', y_axis: 'left' },
				{ data_key: 'orders', series_type: 'line', y_axis: 'right' },
			],
			{ y_axis_label: 'Revenue', y_axis_right_label: 'Orders' },
			{ includeLegend: false },
		);
		expect(svg).toContain('Revenue');
		expect(svg).toContain('Orders');
	});
});

describe('renderChartToSvg (horizontal bar)', () => {
	it('labels every bar when the rows fit the chart height', () => {
		const svg = renderHorizontalBar(COUNTRIES.map((country, index) => ({ country, production: 100 - index })));

		expect(readCategoryLabels(svg)).toEqual(COUNTRIES);
	});

	it('skips category labels once the rows are denser than a line of text', () => {
		const rows = Array.from({ length: 60 }, (_, index) => ({ country: `Country ${index + 1}`, production: index }));
		const labels = readCategoryLabels(renderHorizontalBar(rows));

		expect(labels.length).toBeGreaterThan(1);
		expect(labels.length).toBeLessThan(rows.length);
	});
});

describe('renderChartToSvg legend visibility', () => {
	it('draws the legend by default', () => {
		expect(render({})).toContain(SERIES_LABEL);
	});

	it('hides the legend when show_legend is false', () => {
		expect(render({ show_legend: false })).not.toContain(SERIES_LABEL);
	});

	it('hides the pie legend when show_legend is false', () => {
		expect(render({ chart_type: 'pie' })).toContain('>Jan<');
		expect(render({ chart_type: 'pie', show_legend: false })).not.toContain('>Jan<');
	});

	it('keeps the legend hidden when the caller excludes it, even if show_legend is true', () => {
		expect(render({ show_legend: true }, { includeLegend: false })).not.toContain(SERIES_LABEL);
	});
});

function render(
	config: Partial<ChartConfig>,
	{ data = MONTHLY_ROWS, includeLegend }: { data?: Record<string, unknown>[]; includeLegend?: boolean } = {},
): string {
	return renderChartToSvg({
		config: {
			chart_type: 'bar',
			x_axis_key: 'month',
			x_axis_type: 'category',
			series: [{ data_key: 'revenue', label: SERIES_LABEL }],
			...config,
		},
		data,
		includeLegend,
	});
}

function renderCombo(
	series: displayChart.SeriesConfig[],
	config: Partial<ChartConfig> = {},
	options: { includeLegend?: boolean } = {},
): string {
	return render({ chart_type: 'mixed', title: 'Test', series, ...config }, options);
}

function renderHorizontalBar(data: Record<string, unknown>[]): string {
	return render(
		{ chart_type: 'horizontal_bar', x_axis_key: 'country', series: [{ data_key: 'production' }] },
		{ data },
	);
}

function countYAxes(svg: string): number {
	return (svg.match(/recharts-yAxis/g) ?? []).length;
}

function readCategoryLabels(svg: string): string[] {
	const labelPattern = /class="recharts-text recharts-cartesian-axis-tick-value"[^>]*>([^<]*)<\/text>/g;
	return [...svg.matchAll(labelPattern)].map((match) => match[1]);
}
