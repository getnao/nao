// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TestDataDiffView } from './test-data-diff';
import type { TestDataDiff } from './test-run-types';

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

	it('counts the rows by kind and shows the reference value under a different one', () => {
		render(<TestDataDiffView diff={DIFF} />);

		expect(screen.getByText('1 matching')).toBeTruthy();
		expect(screen.getByText('1 different')).toBeTruthy();
		expect(screen.getByText('1 missing from the answer')).toBeTruthy();
		expect(screen.getByText('1 not expected')).toBeTruthy();
		const differentCell = screen.getByText('200').closest('td');
		expect(differentCell?.textContent).toBe('200210');
		expect(screen.getByText('orders')).toBeTruthy();
	});

	it('hides the matching rows on demand', () => {
		render(<TestDataDiffView diff={DIFF} />);

		fireEvent.click(screen.getByRole('switch', { name: 'Only show the differences' }));

		expect(screen.queryByText('jan')).toBeNull();
		expect(screen.getByText('feb')).toBeTruthy();
		expect(screen.getByText('mar')).toBeTruthy();
	});
});
