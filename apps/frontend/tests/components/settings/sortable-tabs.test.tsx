// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SortableTabs } from '@/components/settings/sortable-tabs';

const TABS = ['/docs/a.md', '/docs/b.md', '/docs/c.md'];

describe('SortableTabs', () => {
	afterEach(cleanup);

	it.each([
		{ item: 'Close', expected: ['/docs/b.md'] },
		{ item: 'Close others', expected: ['/docs/a.md', '/docs/c.md'] },
		{ item: 'Close to the right', expected: ['/docs/c.md'] },
		{ item: 'Close all', expected: TABS },
	])('closes the tabs picked by "$item" from the menu of a tab', ({ item, expected }) => {
		const onCloseTabs = vi.fn();
		renderTabs({ onCloseTabs });

		fireEvent.contextMenu(screen.getByRole('tab', { name: 'b.md' }));
		fireEvent.click(screen.getByRole('menuitem', { name: item }));

		expect(onCloseTabs).toHaveBeenCalledWith(expected);
	});

	it('cannot close the tabs to the right of the last tab', () => {
		renderTabs({ onCloseTabs: vi.fn() });

		fireEvent.contextMenu(screen.getByRole('tab', { name: 'c.md' }));

		expect(screen.getByRole('menuitem', { name: 'Close to the right' }).hasAttribute('data-disabled')).toBe(true);
	});

	it('names a tab after its file, with the folder telling it apart from a namesake', () => {
		renderTabs({ getDescription: (path) => (path === '/docs/b.md' ? 'docs' : undefined) });

		expect(screen.getByRole('tab', { name: 'b.md, docs' }).getAttribute('title')).toBe('/docs/b.md');
	});
});

function renderTabs(props: Partial<Parameters<typeof SortableTabs>[0]>) {
	return render(
		<SortableTabs
			paths={TABS}
			activePath='/docs/a.md'
			onSelect={vi.fn()}
			onClose={vi.fn()}
			onMove={vi.fn()}
			{...props}
		/>,
	);
}
