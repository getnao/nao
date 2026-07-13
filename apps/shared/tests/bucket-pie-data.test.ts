import { describe, expect, it } from 'vitest';

import { bucketPieData } from '../src/chart-builder';
import { isPieChart } from '../src/tools/display-chart';

const rowsOf = (values: number[]) => values.map((value, index) => ({ category: `cat-${index}`, total: value }));

describe('bucketPieData', () => {
	it('returns rows unchanged when at or below the max slices', () => {
		const rows = rowsOf([5, 4, 3, 2, 1]);
		expect(bucketPieData(rows, 'category', 'total', 10)).toBe(rows);
	});

	it('returns rows unchanged at exactly the max slices', () => {
		const rows = rowsOf(Array.from({ length: 10 }, (_, i) => 10 - i));
		expect(bucketPieData(rows, 'category', 'total', 10)).toBe(rows);
	});

	it('keeps the top slices and aggregates the rest into a single "Other" slice', () => {
		const rows = rowsOf([100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 5, 3]);
		const bucketed = bucketPieData(rows, 'category', 'total', 10);

		expect(bucketed).toHaveLength(11);
		const other = bucketed[bucketed.length - 1];
		expect(other.category).toBe('Other');
		expect(other.total).toBe(8);
	});

	it('keeps the largest slices regardless of input order', () => {
		const rows = [
			{ category: 'small', total: 1 },
			{ category: 'huge', total: 100 },
			{ category: 'mid', total: 50 },
		];
		const bucketed = bucketPieData(rows, 'category', 'total', 2);

		expect(bucketed.map((r) => r.category)).toEqual(['huge', 'mid', 'Other']);
		expect(bucketed[bucketed.length - 1].total).toBe(1);
	});

	it('merges the aggregate into an existing "Other" category instead of duplicating it', () => {
		const rows = [
			{ category: 'a', total: 100 },
			{ category: 'Other', total: 40 },
			{ category: 'b', total: 5 },
			{ category: 'c', total: 3 },
		];
		const bucketed = bucketPieData(rows, 'category', 'total', 2);

		const others = bucketed.filter((r) => r.category === 'Other');
		expect(others).toHaveLength(1);
		// existing Other (40) + bucketed remainder (5 + 3)
		expect(others[0].total).toBe(48);
		expect(bucketed.map((r) => r.category)).toEqual(['a', 'Other']);
	});

	it('treats non-numeric values as zero when summing "Other"', () => {
		const rows = [
			{ category: 'a', total: 10 },
			{ category: 'b', total: 8 },
			{ category: 'c', total: null },
			{ category: 'd', total: 'oops' },
		];
		const bucketed = bucketPieData(rows, 'category', 'total', 2);

		expect(bucketed).toHaveLength(3);
		expect(bucketed[bucketed.length - 1]).toEqual({ category: 'Other', total: 0 });
	});

	it('does not mutate the input rows', () => {
		const rows = rowsOf([3, 2, 1]);
		const snapshot = JSON.stringify(rows);
		bucketPieData(rows, 'category', 'total', 1);
		expect(JSON.stringify(rows)).toBe(snapshot);
	});
});

describe('isPieChart', () => {
	it('is true for pie and donut', () => {
		expect(isPieChart('pie')).toBe(true);
		expect(isPieChart('donut')).toBe(true);
	});

	it('is false for other chart types', () => {
		for (const type of ['bar', 'stacked_bar', 'line', 'area', 'scatter', 'radar', 'kpi_card'] as const) {
			expect(isPieChart(type)).toBe(false);
		}
	});
});
