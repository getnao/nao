// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FileTreeEntry } from '@nao/shared/types';
import type { FileChangeMark } from '@/components/settings/file-tree';
import { FileTree } from '@/components/settings/file-tree';
import { TooltipProvider } from '@/components/ui/tooltip';

describe('FileTree change marks', () => {
	afterEach(cleanup);

	it('marks a changed file with how it changed and the folders holding it', () => {
		renderTree({
			search: '',
			onSearchChange: vi.fn(),
			entries: [
				{
					name: 'docs',
					path: '/docs',
					type: 'directory',
					children: [{ name: 'orders.md', path: '/docs/orders.md', type: 'file' }],
				},
				{ name: 'RULES.md', path: '/RULES.md', type: 'file' },
			],
			changeMarks: new Map([['/docs/orders.md', { kind: 'modified', isUpstream: false }]]),
		});

		expect(screen.getAllByLabelText('Holds changed files')).toHaveLength(1);
		fireEvent.click(screen.getByRole('button', { name: /docs/ }));
		expect(screen.getByRole('button', { name: /orders\.md/ }).textContent).toContain('Edited');
		expect(screen.getByRole('button', { name: /RULES\.md/ }).textContent).not.toContain('Edited');
	});
});

describe('FileTree search', () => {
	afterEach(cleanup);

	it.each([
		{
			action: 'the clear button',
			clear: () => fireEvent.click(screen.getByRole('button', { name: 'Clear search' })),
		},
		{
			action: 'Escape',
			clear: () => fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search files' }), { key: 'Escape' }),
		},
	])('clears the search with $action', ({ clear }) => {
		const onSearchChange = vi.fn();
		renderTree({ search: 'orders', onSearchChange });

		clear();

		expect(onSearchChange).toHaveBeenCalledWith('');
	});

	it('offers to clear the search only once there is one', () => {
		renderTree({ search: '', onSearchChange: vi.fn() });

		expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
	});
});

function renderTree({
	search,
	onSearchChange,
	entries = [],
	changeMarks,
}: {
	search: string;
	onSearchChange: (value: string) => void;
	entries?: FileTreeEntry[];
	changeMarks?: Map<string, FileChangeMark>;
}) {
	render(
		<TooltipProvider>
			<FileTree
				entries={entries}
				changeMarks={changeMarks}
				selectedPath={null}
				onSelectFile={vi.fn()}
				search={search}
				onSearchChange={onSearchChange}
				isContentSearchEnabled={false}
				onContentSearchEnabledChange={vi.fn()}
				contentMatches={new Map()}
				isContentSearchPending={false}
				contentSearchFailed={false}
				contentSearchTruncated={false}
			/>
		</TooltipProvider>,
	);
}
