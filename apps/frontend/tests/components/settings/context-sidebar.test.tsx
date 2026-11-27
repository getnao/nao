// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ContextSidebar } from '@/components/settings/context-sidebar';

describe('ContextSidebar', () => {
	beforeEach(() => localStorage.clear());
	afterEach(cleanup);

	it('shows sync to the right of changes and opens it as a sidebar view', () => {
		render(<ContextSidebar changeCount={1} files='Files content' changes='Changes content' sync='Sync content' />);

		expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Files', 'Changes1', 'Sync']);

		fireEvent.click(screen.getByRole('tab', { name: 'Sync' }));

		expect(screen.getByRole('tab', { name: 'Sync' }).getAttribute('aria-selected')).toBe('true');
		expect(screen.getByText('Sync content').closest('.hidden')).toBeNull();
	});
});
