import { describe, expect, it } from 'vitest';

import { profileColumn, summarizeChartSelection } from './chart-selection-summary';

const rows = [
	{ month: '2025-01', revenue: 100, orders: 4, region: 'EU' },
	{ month: '2025-02', revenue: 250, orders: 7, region: 'EU' },
	{ month: '2025-03', revenue: 175, orders: 5, region: 'US' },
];

const palette = ['#111111', '#222222'];
const base = { query_id: 'q1', title: 'Revenue' };

describe('profileColumn', () => {
	it('profiles numeric columns', () => {
		const profile = profileColumn(rows, 'revenue');
		expect(profile).toMatchObject({ exists: true, kind: 'number', distinctCount: 3, nullCount: 0 });
	});

	it('detects ISO dates', () => {
		expect(profileColumn(rows, 'month')).toMatchObject({ kind: 'date', distinctCount: 3 });
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
					{ data_key: 'revenue', label: 'Revenue' },
					{ data_key: 'orders', color: '#abcdef' },
				],
			},
			rows,
			palette,
		);

		expect(summary.xAxis).toMatchObject({ column: 'month', exists: true });
		expect(summary.series[0]).toMatchObject({ label: 'Revenue', color: '#111111' });
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

	it('ignores null x values when detecting repeats and flags all-null series', () => {
		const summary = summarizeChartSelection(
			{
				...base,
				chart_type: 'bar',
				x_axis_key: 'region',
				x_axis_type: 'category',
				series: [{ data_key: 'revenue' }, { data_key: 'refunds', label: 'Refunds' }],
			},
			[
				{ region: 'EU', revenue: 100, refunds: null },
				{ region: 'US', revenue: 250, refunds: null },
				{ region: null, revenue: 175, refunds: null },
			],
			palette,
		);

		expect(summary.issues).toEqual(['Series "Refunds" has no values to plot.']);
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
