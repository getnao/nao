import { describe, expect, it } from 'vitest';

import { diffSplitLines } from '@/lib/split-diff';

describe('diffSplitLines', () => {
	it('ignores lines that only differ in spacing or letter case', () => {
		const changes = diffSplitLines('SELECT\n  month,\n  total', 'select\n    MONTH,\n  total');

		expect(changes.before.size).toBe(0);
		expect(changes.after.size).toBe(0);
	});

	it('marks only the words that changed in a line that replaces another', () => {
		const before = "WHERE status = 'paid'\n  AND month < 4";
		const after = "WHERE status = 'paid'\n  AND month <> 4";

		const changes = diffSplitLines(before, after);

		expect(changes.before).toEqual(new Map([[1, [{ start: 12, end: 13 }]]]));
		expect(changes.after).toEqual(new Map([[1, [{ start: 12, end: 14 }]]]));
	});

	it('marks quoted values that only differ in letter case or spacing', () => {
		const changes = diffSplitLines("WHERE status = 'PAID'", "WHERE status = 'paid'");

		expect(changes.before).toEqual(new Map([[0, [{ start: 15, end: 21 }]]]));
		expect(changes.after).toEqual(new Map([[0, [{ start: 15, end: 21 }]]]));
	});

	it('marks quoted identifiers that only differ in letter case', () => {
		const changes = diffSplitLines('SELECT "Month" FROM orders', 'SELECT "month" FROM orders');

		expect(changes.before).toEqual(new Map([[0, [{ start: 7, end: 14 }]]]));
		expect(changes.after).toEqual(new Map([[0, [{ start: 7, end: 14 }]]]));
	});

	it('ignores a line whose words are the same once its spaces are left out', () => {
		const changes = diffSplitLines('SELECT a,b', 'SELECT a, b');

		expect(changes.before.size).toBe(0);
		expect(changes.after.size).toBe(0);
	});

	it('marks the whole of a line that only one side has', () => {
		const changes = diffSplitLines('SELECT month\nFROM orders', 'SELECT month\nFROM orders\nWHERE paid');

		expect(changes.before.size).toBe(0);
		expect(changes.after).toEqual(new Map([[2, [{ start: 0, end: 10 }]]]));
	});
});
