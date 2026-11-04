import { describe, expect, it } from 'vitest';

import { DEFAULT_TEST_COMPARISON_TOLERANCES } from '../src/types/test-run';
import {
	buildTestDataDiff,
	compareTestData,
	normalizeFormattedNumber,
	orderRecordsForComparison,
} from '../src/utils/test-data-comparison';

describe('compareTestData', () => {
	it('treats comma-formatted numbers as equal to raw numbers', () => {
		const verdict = compareTestData({
			actual: [{ total: '52,123,123' }],
			expected: [{ total: 52123123 }],
			expectedColumns: ['total'],
		});

		expect(verdict).toEqual({ passed: true, message: 'match', comparison: null });
	});

	it('still detects a mismatch on formatted numbers', () => {
		const verdict = compareTestData({
			actual: [{ total: '52,000,000' }],
			expected: [{ total: 52123123 }],
			expectedColumns: ['total'],
		});

		expect(verdict.passed).toBe(false);
		expect(verdict.message).toBe('values differ');
		expect(verdict.comparison).toBe('row 0, total: actual=52000000, expected=52123123');
	});

	it('rounds floats to two decimals by default', () => {
		const verdict = compareTestData({
			actual: [{ value: 1.234, label: 'a' }],
			expected: [{ value: 1.231, label: 'a' }],
			expectedColumns: ['value', 'label'],
		});

		expect(verdict.passed).toBe(true);
	});

	it('honours a custom number of decimals', () => {
		const verdict = compareTestData(
			{
				actual: [{ value: 1.234 }],
				expected: [{ value: 1.231 }],
				expectedColumns: ['value'],
			},
			{ rtol: 0, atol: 0, decimals: 3 },
		);

		expect(verdict.passed).toBe(false);
	});

	it('reports the verification error when no data was produced', () => {
		const verdict = compareTestData({
			actual: null,
			expected: [{ total: 1 }],
			expectedColumns: ['total'],
			error: 'Binder Error: column total does not exist',
		});

		expect(verdict).toEqual({
			passed: false,
			message: 'Binder Error: column total does not exist',
			comparison: null,
		});
	});

	it('ignores row order, column order and extra columns', () => {
		const verdict = compareTestData({
			actual: [
				{ extra: 'x', revenue: 20, country: 'FR' },
				{ extra: 'y', revenue: 10, country: 'DE' },
			],
			expected: [
				{ country: 'DE', revenue: 10 },
				{ country: 'FR', revenue: 20 },
			],
			expectedColumns: ['country', 'revenue'],
		});

		expect(verdict).toEqual({ passed: true, message: 'match', comparison: null });
	});

	it('matches numbers within tolerances', () => {
		const verdict = compareTestData({
			actual: [{ count: 1000000 }],
			expected: [{ count: 1000001 }],
			expectedColumns: ['count'],
		});

		expect(verdict).toEqual({ passed: true, message: 'match (approximate)', comparison: null });
	});

	it('fails on missing columns', () => {
		const verdict = compareTestData({
			actual: [{ total: 1 }],
			expected: [{ total: 1, country: 'FR' }],
			expectedColumns: ['total', 'country'],
		});

		expect(verdict.message).toBe('missing columns: country');
	});

	it('fails on columns of the expected rows missing from the answer when the column list is unknown', () => {
		const verdict = compareTestData({
			actual: [{ total: 1 }],
			expected: [{ total: 1, country: 'FR' }],
			expectedColumns: [],
		});

		expect(verdict.message).toBe('missing columns: country');
	});

	it('fails on a row count difference', () => {
		const verdict = compareTestData({
			actual: [{ total: 1 }],
			expected: [{ total: 1 }, { total: 2 }],
			expectedColumns: ['total'],
		});

		expect(verdict.message).toBe('row count: 1 vs 2');
	});

	it('handles empty results', () => {
		expect(compareTestData({ actual: [], expected: [], expectedColumns: ['total'] }).message).toBe('both empty');
		expect(compareTestData({ actual: [], expected: [{ total: 1 }], expectedColumns: ['total'] }).message).toBe(
			'actual is empty',
		);
		expect(compareTestData({ actual: [{ total: 1 }], expected: [], expectedColumns: ['total'] }).message).toBe(
			'expected is empty',
		);
	});

	it('compares missing values as equal to each other only', () => {
		expect(
			compareTestData({
				actual: [{ total: null }, { total: 1.5 }],
				expected: [{ total: null }, { total: 1.5 }],
				expectedColumns: ['total'],
			}).passed,
		).toBe(true);
		expect(
			compareTestData({
				actual: [{ total: null }],
				expected: [{ total: 0 }],
				expectedColumns: ['total'],
			}).passed,
		).toBe(false);
	});

	it('compares dates by their ISO representation', () => {
		const verdict = compareTestData({
			actual: [{ day: '2026-01-01T00:00:00.000Z' }],
			expected: [{ day: new Date('2026-01-01T00:00:00.000Z') }],
			expectedColumns: ['day'],
		});

		expect(verdict.passed).toBe(true);
	});

	it('treats a midnight timestamp as equal to the same date', () => {
		const verdict = compareTestData({
			actual: [{ order_month: '2018-04-01' }, { order_month: '2018-02-01' }],
			expected: [{ order_month: '2018-02-01T00:00:00' }, { order_month: '2018-04-01 00:00:00.000 UTC' }],
			expectedColumns: ['order_month'],
		});

		expect(verdict).toEqual({ passed: true, message: 'match', comparison: null });
	});

	it('writes timestamps one way but keeps their time of day', () => {
		const compareTimestamps = (actual: string, expected: string) =>
			compareTestData({ actual: [{ at: actual }], expected: [{ at: expected }], expectedColumns: ['at'] }).passed;

		expect(compareTimestamps('2018-04-01 12:30:00', '2018-04-01T12:30:00.000Z')).toBe(true);
		expect(compareTimestamps('2018-04-01T12:30', '2018-04-01T12:30:00')).toBe(true);
		expect(compareTimestamps('2018-04-01T12:30:00', '2018-04-01')).toBe(false);
		expect(compareTimestamps('2018-04-01T00:00:00+02:00', '2018-04-01')).toBe(false);
	});

	it('treats a month as equal to its first day when a whole column holds months', () => {
		const verdict = compareTestData({
			actual: [
				{ order_month: '2018-04', revenue: 24 },
				{ order_month: '2018-01', revenue: 218 },
			],
			expected: [
				{ order_month: '2018-01-01T00:00:00', revenue: 218 },
				{ order_month: '2018-04-01T00:00:00', revenue: 24 },
			],
			expectedColumns: ['order_month', 'revenue'],
		});

		expect(verdict).toEqual({ passed: true, message: 'match', comparison: null });
	});

	it('keeps comparing days when a date column is not only first days of months', () => {
		const verdict = compareTestData({
			actual: [{ order_month: '2018-04' }, { order_month: '2018-01' }],
			expected: [{ order_month: '2018-04-01' }, { order_month: '2018-01-15' }],
			expectedColumns: ['order_month'],
		});

		expect(verdict.passed).toBe(false);
	});
});

describe('normalizeFormattedNumber', () => {
	it.each([
		['52,123,123', 52123123],
		['1,234.56', 1234.56],
		['  9,999  ', 9999],
		['-1,000', -1000],
		['1.234.567,89', 1234567.89],
		['1.234.567', 1234567],
		['$1,234.50', 1234.5],
		['-$1,234.50', -1234.5],
		['12,5', 12.5],
		['1,23', 1.23],
		[52123123, 52123123],
		['not a number', 'not a number'],
		['', ''],
		[',', ','],
	])('normalizes %j to %j', (value, expected) => {
		expect(normalizeFormattedNumber(value)).toBe(expected);
	});
});

describe('buildTestDataDiff', () => {
	it('shows months and dates the way the verdict compared them', () => {
		const diff = buildTestDataDiff({
			actual: [{ order_month: '2018-04' }],
			expected: [{ order_month: '2018-04-01T00:00:00' }],
			expectedColumns: ['order_month'],
		});

		expect(diff?.rows).toEqual([{ expected: ['2018-04'], actual: ['2018-04'], statuses: ['match'] }]);
	});

	it('pairs the rows in the order the verdict compares them, columns as the test declares them', () => {
		const diff = buildTestDataDiff({
			actual: [
				{ total: 200, month: 'feb' },
				{ total: 100.004, month: 'jan' },
			],
			expected: [
				{ month: 'jan', total: 100 },
				{ month: 'feb', total: 210 },
			],
			expectedColumns: ['total', 'month'],
		});

		expect(diff).toEqual({
			columns: ['total', 'month'],
			missingColumns: [],
			extraColumns: [],
			expectedRowCount: 2,
			actualRowCount: 2,
			isTruncated: false,
			rows: [
				{ expected: [210, 'feb'], actual: [200, 'feb'], statuses: ['differ', 'match'] },
				{ expected: [100, 'jan'], actual: [100, 'jan'], statuses: ['match', 'match'] },
			],
		});
	});

	it('marks numbers within the tolerances as close', () => {
		const diff = buildTestDataDiff(
			{ actual: [{ total: 100.5 }], expected: [{ total: 100 }], expectedColumns: [] },
			{ ...DEFAULT_TEST_COMPARISON_TOLERANCES, rtol: 0.01 },
		);

		expect(diff?.rows[0].statuses).toEqual(['close']);
	});

	it('reports the expected columns the answer misses and the ones it adds', () => {
		const diff = buildTestDataDiff({
			actual: [{ month: 'jan', orders: 3 }],
			expected: [{ month: 'jan', total: 100 }],
			expectedColumns: [],
		});

		expect(diff).toMatchObject({
			columns: ['month', 'total'],
			missingColumns: ['total'],
			extraColumns: ['orders'],
			rows: [{ expected: ['jan', 100], actual: ['jan', null], statuses: ['match', 'differ'] }],
		});
	});

	it('lines up identical rows when the row counts differ, so the missing and extra ones stand out', () => {
		const diff = buildTestDataDiff({
			actual: [
				{ month: 'jan', total: 100 },
				{ month: 'mar', total: 300 },
				{ month: 'may', total: 500 },
			],
			expected: [
				{ month: 'jan', total: 100 },
				{ month: 'feb', total: 200 },
				{ month: 'mar', total: 300 },
				{ month: 'apr', total: 400 },
			],
			expectedColumns: [],
		});

		expect(diff?.rows).toEqual([
			{ expected: ['apr', 400], actual: null, statuses: null },
			{ expected: ['feb', 200], actual: null, statuses: null },
			{ expected: ['jan', 100], actual: ['jan', 100], statuses: ['match', 'match'] },
			{ expected: ['mar', 300], actual: ['mar', 300], statuses: ['match', 'match'] },
			{ expected: null, actual: ['may', 500], statuses: null },
		]);
	});

	it('flags rows cut before they were stored', () => {
		const diff = buildTestDataDiff(
			{ actual: [{ total: 1 }], expected: [{ total: 1 }], expectedColumns: [] },
			DEFAULT_TEST_COMPARISON_TOLERANCES,
			{ actual: 120, expected: 1 },
		);

		expect(diff).toMatchObject({ actualRowCount: 120, expectedRowCount: 1, isTruncated: true });
	});

	it('has nothing to show without an answer', () => {
		expect(buildTestDataDiff({ actual: null, expected: [{ total: 1 }], expectedColumns: [] })).toBeNull();
	});
});

describe('orderRecordsForComparison', () => {
	it('sorts the raw records the way the verdict sorts their normalized rows', () => {
		const records = [
			{ month: 'mar', total: '3,000' },
			{ month: 'jan', total: '1,000' },
			{ month: 'feb', total: '2,000' },
		];

		expect(orderRecordsForComparison(records, ['total'])).toEqual([records[1], records[2], records[0]]);
	});
});
