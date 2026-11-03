// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TestDataDiffView } from './test-data-diff';
import type { TestDataDiff } from './test-run-types';

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
