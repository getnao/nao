import { describe, expect, it } from 'vitest';

import { inferColumnSortKind, sortRowsByColumn } from '../src/story-table-utils';

describe('inferColumnSortKind', () => {
	it('returns numeric when every present value is a finite number', () => {
		const rows = [{ x: 1 }, { x: 2.5 }, { x: -3 }];
		expect(inferColumnSortKind(rows, 'x')).toBe('numeric');
	});

	it('ignores null and undefined when inferring numeric kind', () => {
		const rows = [{ x: 1 }, { x: null }, { x: 2 }, { x: undefined }];
		expect(inferColumnSortKind(rows, 'x')).toBe('numeric');
	});

	it('returns date when every present value is an ISO-like date string', () => {
		const rows = [{ d: '2024-01-01' }, { d: '2024-06-15T12:30:00Z' }, { d: '2025-12-31 23:59:59' }];
		expect(inferColumnSortKind(rows, 'd')).toBe('date');
	});

	it('returns string when values mix numbers and strings', () => {
		const rows = [{ x: 1 }, { x: 'two' }];
		expect(inferColumnSortKind(rows, 'x')).toBe('string');
	});

	it('returns string when date strings are ambiguous (year-only)', () => {
		const rows = [{ y: '2024' }, { y: '2025' }];
		expect(inferColumnSortKind(rows, 'y')).toBe('string');
	});

	it('returns string when column is empty or all null', () => {
		expect(inferColumnSortKind([], 'x')).toBe('string');
		expect(inferColumnSortKind([{ x: null }, { x: undefined }], 'x')).toBe('string');
	});
});

describe('sortRowsByColumn', () => {
	it('sorts numeric ascending', () => {
		const rows = [{ x: 3 }, { x: 1 }, { x: 2 }];
		expect(sortRowsByColumn(rows, 'x', 'asc', 'numeric')).toEqual([{ x: 1 }, { x: 2 }, { x: 3 }]);
	});

	it('sorts numeric descending', () => {
		const rows = [{ x: 3 }, { x: 1 }, { x: 2 }];
		expect(sortRowsByColumn(rows, 'x', 'desc', 'numeric')).toEqual([{ x: 3 }, { x: 2 }, { x: 1 }]);
	});

	it('places nulls and undefined last regardless of direction', () => {
		const rows = [{ x: 2 }, { x: null }, { x: 1 }, { x: undefined }];
		const asc = sortRowsByColumn(rows, 'x', 'asc', 'numeric');
		expect(asc.slice(0, 2)).toEqual([{ x: 1 }, { x: 2 }]);
		expect(asc[2].x == null).toBe(true);
		expect(asc[3].x == null).toBe(true);

		const desc = sortRowsByColumn(rows, 'x', 'desc', 'numeric');
		expect(desc.slice(0, 2)).toEqual([{ x: 2 }, { x: 1 }]);
		expect(desc[2].x == null).toBe(true);
		expect(desc[3].x == null).toBe(true);
	});

	it('sorts date strings chronologically', () => {
		const rows = [{ d: '2024-12-01' }, { d: '2024-01-15' }, { d: '2024-06-30T10:00:00Z' }];
		expect(sortRowsByColumn(rows, 'd', 'asc', 'date')).toEqual([
			{ d: '2024-01-15' },
			{ d: '2024-06-30T10:00:00Z' },
			{ d: '2024-12-01' },
		]);
	});

	it('sorts strings via locale compare', () => {
		const rows = [{ s: 'banana' }, { s: 'apple' }, { s: 'cherry' }];
		expect(sortRowsByColumn(rows, 's', 'asc', 'string')).toEqual([
			{ s: 'apple' },
			{ s: 'banana' },
			{ s: 'cherry' },
		]);
	});

	it('keeps original order for equal values (stable)', () => {
		const rows = [
			{ x: 1, label: 'a' },
			{ x: 1, label: 'b' },
			{ x: 1, label: 'c' },
		];
		expect(sortRowsByColumn(rows, 'x', 'asc', 'numeric')).toEqual(rows);
		expect(sortRowsByColumn(rows, 'x', 'desc', 'numeric')).toEqual(rows);
	});

	it('does not mutate the input array', () => {
		const rows = [{ x: 3 }, { x: 1 }, { x: 2 }];
		const snapshot = [...rows];
		sortRowsByColumn(rows, 'x', 'asc', 'numeric');
		expect(rows).toEqual(snapshot);
	});

	it('treats missing column as all-null and preserves original order', () => {
		const rows = [{ x: 1 }, { x: 2 }, { x: 3 }];
		expect(sortRowsByColumn(rows, 'missing', 'asc', 'string')).toEqual(rows);
	});
});
