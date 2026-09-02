import { describe, expect, it } from 'vitest';

import { toSheetTable } from './sheet-table';

describe('toSheetTable', () => {
	it('names the columns after a filled first row', () => {
		expect(
			toSheetTable([
				['name', 'amount'],
				['Alpha', 12],
			]),
		).toEqual({
			columns: ['name', 'amount'],
			rows: [{ name: 'Alpha', amount: 12 }],
		});
	});

	it('falls back to column letters when the first row is not a header', () => {
		expect(
			toSheetTable([
				[null, 2025],
				['Alpha', 12],
			]),
		).toEqual({
			columns: ['A', 'B'],
			rows: [
				{ A: null, B: 2025 },
				{ A: 'Alpha', B: 12 },
			],
		});
	});

	it('does not mistake holes in a sparse first row for complete headers', () => {
		const sparse = Array(2) as unknown[];
		sparse[0] = 'name';

		expect(toSheetTable([sparse, ['Alpha', 12]])).toEqual({
			columns: ['A', 'B'],
			rows: [
				{ A: 'name', B: null },
				{ A: 'Alpha', B: 12 },
			],
		});
	});

	it('pads short rows out to the widest one', () => {
		expect(toSheetTable([['a', 'b', 'c'], ['1']])).toEqual({
			columns: ['a', 'b', 'c'],
			rows: [{ a: '1', b: null, c: null }],
		});
	});

	it('gives a repeated header label a name of its own', () => {
		expect(
			toSheetTable([
				['total', 'total'],
				[1, 2],
			]),
		).toEqual({
			columns: ['total', 'total (2)'],
			rows: [{ total: 1, 'total (2)': 2 }],
		});
	});

	it('renders a date cell from its ISO form', () => {
		expect(toSheetTable([['day'], [new Date('2026-01-31T00:00:00.000Z')]])).toEqual({
			columns: ['day'],
			rows: [{ day: '2026-01-31T00:00:00.000Z' }],
		});
	});

	it('counts past the alphabet for a wide sheet', () => {
		const { columns } = toSheetTable([Array.from({ length: 28 }, () => null)]);

		expect(columns.slice(24)).toEqual(['Y', 'Z', 'AA', 'AB']);
	});

	it('returns nothing for an empty grid', () => {
		expect(toSheetTable([])).toEqual({ columns: [], rows: [] });
	});
});
