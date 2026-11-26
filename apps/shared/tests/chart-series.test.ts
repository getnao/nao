import { describe, expect, it } from 'vitest';

import { applyBreakdown, type ChartBreakdownInput } from '../src/chart-series';

const VERSION_ROWS = [
	{ week: '2026-11-09', nao_version: '0.4.2', domains: 26 },
	{ week: '2026-11-09', nao_version: '0.3', domains: 122 },
	{ week: '2026-11-16', nao_version: '0.4.10', domains: 3 },
	{ week: '2026-11-16', nao_version: '0.4.2', domains: 11 },
	{ week: '2026-11-16', nao_version: '0.3', domains: 81 },
];

function breakdown(overrides: Partial<ChartBreakdownInput> = {}) {
	return applyBreakdown({
		rows: VERSION_ROWS,
		chartType: 'stacked_area',
		xAxisKey: 'week',
		series: [{ data_key: 'domains', color: '#123456' }],
		breakdownKey: 'nao_version',
		...overrides,
	});
}

describe('applyBreakdown', () => {
	it('turns each breakdown value into a series, in natural order, without the metric color', () => {
		const { series } = breakdown();

		expect(series.map((item) => item.label)).toEqual(['0.3', '0.4.2', '0.4.10']);
		expect(series.every((item) => item.color === undefined)).toBe(true);
	});

	it.each([
		{ chartType: 'stacked_area', missing: 0 },
		{ chartType: 'line', missing: null },
	])('pivots one row per x value and fills missing values on $chartType with $missing', ({ chartType, missing }) => {
		const { rows, series } = breakdown({ chartType });
		const [olderKey, , newestKey] = series.map((item) => item.data_key);

		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ week: '2026-11-09', [olderKey]: 122, [newestKey]: missing });
		expect(rows[1]).toMatchObject({ week: '2026-11-16', [olderKey]: 81, [newestKey]: 3 });
	});

	it.each(['', 'T00:00:00', 'T00:00:00.000000'])(
		'keeps the values largest in the latest period on a date axis ("%s" times) and sums the rest into Other',
		(time) => {
			const rows = [...VERSION_ROWS, { week: '2026-11-16', nao_version: '0.4.11', domains: 90 }].map((row) => ({
				...row,
				week: `${row.week}${time}`,
			}));
			const result = breakdown({ rows, breakdownLimit: 1 });

			expect(result.series.map((item) => item.label)).toEqual(['0.4.11', 'Other']);
			expect(result.rows.map((row) => row[result.series[1].data_key])).toEqual([148, 95]);
		},
	);

	it('gives distinct values distinct series keys', () => {
		const rows = ['UK', 'H6', 'a_b', 'a.b', 'a-b'].map((country) => ({ week: '2026-11-09', country, revenue: 1 }));
		const { series } = breakdown({ rows, series: [{ data_key: 'revenue' }], breakdownKey: 'country' });

		expect(new Set(series.map((item) => item.data_key)).size).toBe(5);
	});

	it("keeps a value's series key when new values arrive, so a hidden series stays hidden", () => {
		const keyOf = (rows: typeof VERSION_ROWS) =>
			breakdown({ rows }).series.find((item) => item.label === '0.4.2')?.data_key;
		const withNewVersion = [...VERSION_ROWS, { week: '2026-11-16', nao_version: '0.4.1', domains: 1 }];

		expect(keyOf(withNewVersion)).toBe(keyOf(VERSION_ROWS));
	});

	it('merges a value already named Other into the Other bucket', () => {
		const rows = [...VERSION_ROWS, { week: '2026-11-16', nao_version: 'Other', domains: 500 }];
		const result = breakdown({ rows, breakdownLimit: 1 });

		expect(result.series.map((item) => item.label)).toEqual(['Other']);
		expect(result.rows[1][result.series[0].data_key]).toBe(595);
	});

	it('keeps the largest totals on a category axis', () => {
		const rows = [
			{ region: 'EMEA', plan: 'team', revenue: 1 },
			{ region: 'EMEA', plan: 'pro', revenue: 5 },
			{ region: 'APAC', plan: 'team', revenue: 9 },
		];
		const { series } = breakdown({
			rows,
			xAxisKey: 'region',
			series: [{ data_key: 'revenue' }],
			breakdownKey: 'plan',
			breakdownLimit: 1,
		});

		expect(series.map((item) => item.label)).toEqual(['team', 'Other']);
	});

	it('prefixes labels with the metric when several metrics are broken down', () => {
		const rows = [{ week: '2026-11-09', plan: 'pro', revenue: 5, orders: 2 }];
		const { series } = breakdown({
			rows,
			series: [{ data_key: 'revenue', label: 'Revenue' }, { data_key: 'orders' }],
			breakdownKey: 'plan',
		});

		expect(series.map((item) => item.label)).toEqual(['Revenue · pro', 'Orders · pro']);
	});

	it('resolves column names whose casing changed after a re-execution', () => {
		const rows = VERSION_ROWS.map(({ week, nao_version, domains }) => ({
			WEEK: week,
			NAO_VERSION: nao_version,
			DOMAINS: domains,
		}));

		expect(breakdown({ rows }).series).toHaveLength(3);
	});

	it.each([
		{ case: 'no breakdown_key', overrides: { breakdownKey: undefined } },
		{ case: 'a pie chart', overrides: { chartType: 'pie' } },
		{ case: 'a scatter chart', overrides: { chartType: 'scatter' } },
	])('leaves rows and series untouched for $case', ({ overrides }) => {
		const result = breakdown(overrides);

		expect(result.rows).toBe(VERSION_ROWS);
		expect(result.series).toEqual([{ data_key: 'domains', color: '#123456' }]);
	});
});
