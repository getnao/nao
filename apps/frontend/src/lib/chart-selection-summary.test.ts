import { describe, expect, it } from 'vitest';

import { describeValueFormat, profileColumn, summarizeChartSelection } from './chart-selection-summary';

const rows = [
	{ month: '2025-01', revenue: 100, orders: 4, region: 'EU' },
	{ month: '2025-02', revenue: 250, orders: 7, region: 'EU' },
	{ month: '2025-03', revenue: 175, orders: 5, region: 'US' },
];

const palette = ['#111111', '#222222'];
const base = { query_id: 'q1', title: 'Revenue' };

describe('profileColumn', () => {
	it('profiles numeric columns with range and sum', () => {
		const profile = profileColumn(rows, 'revenue');
		expect(profile).toMatchObject({ exists: true, kind: 'number', distinctCount: 3, min: 100, max: 250, sum: 525 });
	});

	it('detects ISO dates and keeps first and last values', () => {
		const profile = profileColumn(rows, 'month');
		expect(profile).toMatchObject({ kind: 'date', first: '2025-01', last: '2025-03', distinctCount: 3 });
	});

	it('resolves column names case-insensitively and flags missing ones', () => {
		expect(profileColumn(rows, 'REVENUE').column).toBe('revenue');
		expect(profileColumn(rows, 'missing')).toMatchObject({ exists: false, kind: 'empty', distinctCount: 0 });
	});
});

describe('summarizeChartSelection', () => {
	it('describes the x axis and series with palette fallbacks', () => {
		const summary = summarizeChartSelection(
			{
				...base,
				chart_type: 'bar',
				x_axis_key: 'month',
				x_axis_type: null,
				series: [
					{ data_key: 'revenue', label: 'Revenue', value_format: { prefix: '$' } },
					{ data_key: 'orders', color: '#abcdef' },
				],
			},
			rows,
			palette,
		);

		expect(summary.chartLabel).toBe('Bar chart');
		expect(summary.rowCount).toBe(3);
		expect(summary.xAxis).toMatchObject({ label: 'month', axisType: 'date' });
		expect(summary.series[0]).toMatchObject({
			label: 'Revenue',
			color: '#111111',
			formatDescription: 'prefix "$"',
		});
		expect(summary.series[1]).toMatchObject({ label: 'orders', color: '#abcdef' });
		expect(summary.issues).toEqual([]);
	});

	it('reports missing columns, non numeric series and repeated x values', () => {
		const summary = summarizeChartSelection(
			{
				...base,
				chart_type: 'line',
				x_axis_key: 'region',
				x_axis_type: 'category',
				series: [{ data_key: 'region' }, { data_key: 'nope' }],
			},
			rows,
			palette,
		);

		expect(summary.issues).toEqual([
			expect.stringContaining('"region" repeats across rows (2 distinct values for 3 rows)'),
			expect.stringContaining('holds text values rather than numbers'),
			expect.stringContaining('Series column "nope" is not in the query result'),
		]);
	});

	it('flags charts that need an x axis and pies with several series', () => {
		const missingAxis = summarizeChartSelection(
			{ ...base, chart_type: 'line', x_axis_key: '', x_axis_type: null, series: [{ data_key: 'revenue' }] },
			rows,
			palette,
		);
		expect(missingAxis.issues).toContain('This chart type needs an X axis column.');

		const pie = summarizeChartSelection(
			{
				...base,
				chart_type: 'pie',
				x_axis_key: 'region',
				x_axis_type: null,
				series: [{ data_key: 'revenue' }, { data_key: 'orders' }],
			},
			rows,
			palette,
		);
		expect(pie.issues).toEqual(['Pie and donut charts only draw the first series.']);
	});

	it('explains empty results', () => {
		const summary = summarizeChartSelection(
			{ ...base, chart_type: 'kpi_card', x_axis_key: '', x_axis_type: null, series: [] },
			[],
			palette,
		);
		expect(summary.issues).toEqual([
			'The query returned no rows, so the chart has nothing to draw.',
			'Add at least one series to plot a value.',
		]);
	});
});

describe('describeValueFormat', () => {
	it('joins the configured parts and ignores empty formats', () => {
		expect(describeValueFormat(undefined)).toBeUndefined();
		expect(describeValueFormat({})).toBeUndefined();
		expect(describeValueFormat({ prefix: '€', d3_format: ',.2f' })).toBe('prefix "€", number format ,.2f');
	});
});
