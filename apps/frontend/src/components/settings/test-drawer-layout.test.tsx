// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RunsColumn, RunsColumnWidthContext, useRunsColumnWidthState } from './test-drawer-layout';

describe('RunsColumn', () => {
	beforeEach(() => localStorage.clear());

	afterEach(cleanup);

	it('resizes with the arrow keys, Home and End, and goes back to its default width with Enter', () => {
		render(<ResizableRunsColumn />);
		const separator = screen.getByRole('separator', { name: 'Resize the runs column' });

		fireEvent.keyDown(separator, { key: 'ArrowRight' });
		expect(separator.getAttribute('aria-valuenow')).toBe('240');
		expect(localStorage.getItem('nao-test-runs-column-width')).toBe('240');

		fireEvent.keyDown(separator, { key: 'Home' });
		expect(separator.getAttribute('aria-valuenow')).toBe('160');

		fireEvent.keyDown(separator, { key: 'ArrowLeft' });
		expect(separator.getAttribute('aria-valuenow')).toBe('160');

		fireEvent.keyDown(separator, { key: 'End' });
		expect(separator.getAttribute('aria-valuenow')).toBe('520');

		fireEvent.keyDown(separator, { key: 'Enter' });
		expect(separator.getAttribute('aria-valuenow')).toBe('224');
	});
});

function ResizableRunsColumn() {
	const width = useRunsColumnWidthState();
	return (
		<RunsColumnWidthContext.Provider value={width}>
			<RunsColumn label='Test runs'>Runs</RunsColumn>
		</RunsColumnWidthContext.Provider>
	);
}
