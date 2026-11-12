// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { TestDataDiff } from '@/components/settings/test-run-types';
import { TestDataDiffView } from '@/components/settings/test-data-diff';

const SIDES = { removed: 'main', added: 'improve-revenue' };

const DIFF: TestDataDiff = {
	columns: ['month', 'total'],
	missingColumns: [],
	extraColumns: ['orders'],
	expectedRowCount: 3,
	actualRowCount: 3,
	isTruncated: false,
	rows: [
		{ expected: ['feb', 210], actual: ['feb', 200], statuses: ['match', 'differ'] },
		{ expected: ['jan', 100], actual: ['jan', 100], statuses: ['match', 'match'] },
		{ expected: ['mar', 300], actual: null, statuses: null },
		{ expected: null, actual: ['may', 500], statuses: null },
	],
};

describe('TestDataDiffView', () => {
	afterEach(cleanup);

	it('marks the rows only on one side and shows a changed value struck out before the new one', () => {
		render(<TestDataDiffView diff={DIFF} sides={SIDES} />);

		expect(screen.getByTitle('Only on main').textContent).toBe('−');
		expect(screen.getByTitle('Only on improve-revenue').textContent).toBe('+');
		expect(screen.getByText('210').closest('td')?.textContent).toBe('210200');
		expect(screen.getByText('Not compared: orders, only on improve-revenue.')).toBeTruthy();
	});

	it('numbers the rows that match, like a spreadsheet', () => {
		render(<TestDataDiffView diff={DIFF} sides={SIDES} />);

		expect(readColumn(-1)).toEqual(['±', '2', '−', '+']);
	});

	it('sorts the rows by a column, as numbers', () => {
		render(<TestDataDiffView diff={DIFF} sides={SIDES} />);

		fireEvent.click(screen.getByRole('button', { name: 'total' }));

		expect(readColumn(0)).toEqual(['jan', 'feb', 'mar', 'may']);
	});

	it("sorts a row by the answer's value even when the answer is null", () => {
		const rows = [...DIFF.rows, { expected: ['apr', 50], actual: ['apr', null], statuses: ['match', 'differ'] }];
		render(<TestDataDiffView diff={{ ...DIFF, rows } as TestDataDiff} sides={SIDES} />);

		fireEvent.click(screen.getByRole('button', { name: 'total' }));

		expect(readColumn(0)).toEqual(['jan', 'feb', 'mar', 'may', 'apr']);
	});

	it('sizes each column to its header and its longest value, both sides of a changed one', () => {
		const changedDate = {
			expected: ['2018-04-01T00:00:00', 1],
			actual: ['2018-04-01', 1],
			statuses: ['differ', 'match'],
		};
		render(<TestDataDiffView diff={{ ...DIFF, rows: [changedDate] } as TestDataDiff} sides={SIDES} />);

		const [month, total] = screen.getAllByRole('columnheader').slice(1, 3) as HTMLElement[];
		expect(parseFloat(month.style.width)).toBeGreaterThan(200);
		expect(parseFloat(total.style.width)).toBeLessThan(80);
	});

	it('says when neither side has rows', () => {
		render(<TestDataDiffView diff={{ ...DIFF, extraColumns: [], rows: [] }} sides={SIDES} />);

		expect(screen.getByText('No rows on either side.')).toBeTruthy();
	});
});

function readColumn(index: number): string[] {
	return screen
		.getAllByRole('row')
		.slice(1)
		.map((row) => row.querySelectorAll('td')[index + 1]?.textContent ?? '');
}
