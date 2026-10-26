import { describe, expect, it } from 'vitest';

import { compareTestData, normalizeFormattedNumber } from '../src/utils/test-data-comparison';

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
		[52123123, 52123123],
		['not a number', 'not a number'],
		['', ''],
		[',', ','],
	])('normalizes %j to %j', (value, expected) => {
		expect(normalizeFormattedNumber(value)).toBe(expected);
	});
});
