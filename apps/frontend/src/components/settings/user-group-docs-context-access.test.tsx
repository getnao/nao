// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	DocsContextTreeRoot,
	filterDocsContextEntries,
	getDocsContextSelectionCount,
	getDocsContextSelectionSummary,
	getUnavailableDocsContextGrants,
	toggleDocsContextGrant,
} from './user-group-docs-context-access';
import type { DocsContextCatalogEntry } from './user-group-docs-context-access';
import type { DocsContextAccess } from '@nao/shared';

const entries = [
	{ kind: 'folder' as const, path: 'confluence' },
	{ kind: 'folder' as const, path: 'confluence/space=OPS' },
	{ kind: 'folder' as const, path: 'confluence/space=OPS/runbooks' },
	{ kind: 'file' as const, path: 'confluence/space=OPS/runbooks/on-call.md' },
	{ kind: 'folder' as const, path: 'finance' },
	{ kind: 'file' as const, path: 'finance/kpis.md' },
];

afterEach(cleanup);

describe('user group docs context tree', () => {
	it('renders a docs root and grants all docs without creating a root grant', () => {
		const onChange = vi.fn();
		renderTree({ onChange });

		fireEvent.click(screen.getByRole('checkbox', { name: 'docs folder access' }));
		expect(onChange).toHaveBeenCalledWith({ mode: 'all' });
	});

	it('renders compact folder chains and inherited files inside the docs root', () => {
		renderTree({
			access: { mode: 'restricted', grants: [{ kind: 'folder', path: 'confluence/space=OPS/runbooks' }] },
		});

		fireEvent.click(screen.getByRole('button', { name: 'Expand docs folder' }));
		fireEvent.click(screen.getByRole('button', { name: 'Expand confluence/space=OPS folder' }));
		fireEvent.click(screen.getByRole('button', { name: 'Expand runbooks folder' }));

		const file = screen.getByRole('checkbox', { name: 'on-call.md file access' });
		expect(file.getAttribute('data-state')).toBe('checked');
		expect(file.hasAttribute('disabled')).toBe(true);
	});

	it('filters paths, retains ancestors, and expands matches', () => {
		renderTree({ search: 'on-call', searching: true });

		expect(screen.getByText('docs')).toBeTruthy();
		expect(screen.getByText('confluence/space=OPS/runbooks')).toBeTruthy();
		expect(screen.getByText('on-call.md')).toBeTruthy();
		expect(screen.queryByText('finance')).toBeNull();
	});

	it('keeps missing and error roots visible with compact status', () => {
		const { rerender } = renderTree({ entries: [], syncState: 'missing', search: 'finance', searching: true });
		expect(screen.getByText('Missing')).toBeTruthy();

		rerender(
			<DocsContextTreeRoot
				entries={[]}
				access={{ mode: 'restricted', grants: [] }}
				search=''
				searching={false}
				syncState={undefined}
				isLoading={false}
				isError
				disabled={false}
				onRetry={vi.fn()}
				onChange={vi.fn()}
			/>,
		);
		expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
	});

	it('keeps exact grant identity and computes counts', () => {
		const access = toggleDocsContextGrant(
			{ mode: 'restricted', grants: [{ kind: 'file', path: 'finance' }] },
			{ kind: 'folder', path: 'finance' },
			true,
		);
		expect(access).toEqual({
			mode: 'restricted',
			grants: [
				{ kind: 'file', path: 'finance' },
				{ kind: 'folder', path: 'finance' },
			],
		});
		expect(getDocsContextSelectionCount(access, entries)).toBe(1);
		expect(getDocsContextSelectionSummary(access, entries)).toBe('1 doc · 1 unavailable');
		expect(
			getUnavailableDocsContextGrants(
				{ mode: 'restricted', grants: [{ kind: 'file', path: 'deleted.md' }] },
				entries,
			),
		).toEqual([{ kind: 'file', path: 'deleted.md' }]);
		expect(filterDocsContextEntries(entries, 'KPIS')).toEqual([
			{ kind: 'folder', path: 'finance' },
			{ kind: 'file', path: 'finance/kpis.md' },
		]);
	});
});

function renderTree({
	entries: treeEntries = entries,
	access = { mode: 'restricted', grants: [] },
	search = '',
	searching = false,
	syncState = 'ready',
	isLoading = false,
	isError = false,
	disabled = false,
	onRetry = vi.fn(),
	onChange = vi.fn(),
}: {
	entries?: DocsContextCatalogEntry[];
	access?: DocsContextAccess;
	search?: string;
	searching?: boolean;
	syncState?: 'missing' | 'ready';
	isLoading?: boolean;
	isError?: boolean;
	disabled?: boolean;
	onRetry?: () => void;
	onChange?: (access: DocsContextAccess) => void;
} = {}) {
	return render(
		<DocsContextTreeRoot
			entries={treeEntries}
			access={access}
			search={search}
			searching={searching}
			syncState={syncState}
			isLoading={isLoading}
			isError={isError}
			disabled={disabled}
			onRetry={onRetry}
			onChange={onChange}
		/>,
	);
}
