// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	FilesContextTreeRoot,
	filterFilesContextEntries,
	getFilesContextSelectionCount,
	getFilesContextSelectionSummary,
	getUnavailableFilesContextGrants,
	toggleFilesContextGrant,
	UnavailableFilesGrants,
} from './user-group-files-context-access';
import type { FilesContextCatalogEntry } from './user-group-files-context-access';
import type { FilesContextAccess } from '@nao/shared';

const entries = [
	{ kind: 'folder' as const, path: 'analytics' },
	{ kind: 'file' as const, path: 'analytics/overview.md' },
	{ kind: 'folder' as const, path: 'analytics/dashboards' },
	{ kind: 'file' as const, path: 'analytics/dashboards/q3.html' },
	{ kind: 'folder' as const, path: 'finance' },
	{ kind: 'file' as const, path: 'finance/budgets.xlsx' },
	{ kind: 'file' as const, path: 'readme.md' },
];
const fixtureFiles = entries.filter((entry) => entry.kind === 'file');

afterEach(cleanup);

describe('user group files context tree', () => {
	it('renders a files root and grants all files without creating a root grant', () => {
		const onChange = vi.fn();
		renderTree({ onChange });

		fireEvent.click(screen.getByRole('checkbox', { name: 'files folder access' }));
		expect(onChange).toHaveBeenCalledWith({ mode: 'all' });
	});

	it('renders the unrestricted tree with every entry selected', () => {
		renderTree({ access: { mode: 'all' } });

		expect(screen.getByText('files')).toBeTruthy();
		expect(screen.getByRole('checkbox', { name: 'files folder access' }).getAttribute('data-state')).toBe(
			'checked',
		);

		fireEvent.click(screen.getByRole('button', { name: 'Expand files folder' }));
		expect(screen.getByRole('checkbox', { name: 'analytics folder access' }).getAttribute('data-state')).toBe(
			'checked',
		);
		expect(screen.getByRole('checkbox', { name: 'finance folder access' }).getAttribute('data-state')).toBe(
			'checked',
		);
		expect(screen.getByRole('checkbox', { name: 'readme.md file access' }).getAttribute('data-state')).toBe(
			'checked',
		);

		fireEvent.click(screen.getByRole('button', { name: 'Expand analytics folder' }));
		expect(screen.getByRole('checkbox', { name: 'overview.md file access' }).getAttribute('data-state')).toBe(
			'checked',
		);
		expect(screen.getByRole('checkbox', { name: 'dashboards folder access' }).getAttribute('data-state')).toBe(
			'checked',
		);

		fireEvent.click(screen.getByRole('button', { name: 'Expand dashboards folder' }));
		expect(screen.getByRole('checkbox', { name: 'q3.html file access' }).getAttribute('data-state')).toBe(
			'checked',
		);

		fireEvent.click(screen.getByRole('button', { name: 'Expand finance folder' }));
		expect(screen.getByRole('checkbox', { name: 'budgets.xlsx file access' }).getAttribute('data-state')).toBe(
			'checked',
		);
	});

	it('marks granted folders and files as selected and siblings as unselected', () => {
		const access: FilesContextAccess = {
			mode: 'restricted',
			grants: [
				{ kind: 'folder', path: 'analytics' },
				{ kind: 'file', path: 'readme.md' },
			],
		};
		renderTree({ access });

		const root = screen.getByRole('checkbox', { name: 'files folder access' });
		expect(root.getAttribute('data-state')).toBe('indeterminate');
		expect(root.className).toContain('data-[state=indeterminate]:bg-primary/15');
		expect(screen.getByText('Partial').className).toContain('text-muted-foreground');

		fireEvent.click(screen.getByRole('button', { name: 'Expand files folder' }));
		const analyticsAccess = screen.getByRole('checkbox', { name: 'analytics folder access' });
		expect(analyticsAccess.getAttribute('data-state')).toBe('checked');
		expect(analyticsAccess.parentElement?.className).toContain('bg-primary/10');
		expect(screen.getByRole('checkbox', { name: 'finance folder access' }).getAttribute('data-state')).toBe(
			'unchecked',
		);
		expect(screen.getByRole('checkbox', { name: 'readme.md file access' }).getAttribute('data-state')).toBe(
			'checked',
		);

		fireEvent.click(screen.getByRole('button', { name: 'Expand analytics folder' }));
		const dashboardsAccess = screen.getByRole('checkbox', { name: 'dashboards folder access' });
		expect(dashboardsAccess.getAttribute('data-state')).toBe('checked');
		expect(dashboardsAccess.hasAttribute('disabled')).toBe(true);
		const overviewAccess = screen.getByRole('checkbox', { name: 'overview.md file access' });
		expect(overviewAccess.getAttribute('data-state')).toBe('checked');
		expect(overviewAccess.hasAttribute('disabled')).toBe(true);

		fireEvent.click(screen.getByRole('button', { name: 'Expand finance folder' }));
		expect(screen.getByRole('checkbox', { name: 'budgets.xlsx file access' }).getAttribute('data-state')).toBe(
			'unchecked',
		);

		const reachableFromFolder = fixtureFiles.filter((file) => file.path.startsWith('analytics/')).length;
		const reachableFromFileGrant = fixtureFiles.filter((file) => file.path === 'readme.md').length;
		const reachable = reachableFromFolder + reachableFromFileGrant;
		expect(getFilesContextSelectionCount(access, entries)).toBe(reachable);
		expect(getFilesContextSelectionSummary(access, entries)).toBe(`${reachable} files`);
	});

	it('toggles the unrestricted mode off from the files root', () => {
		const onChange = vi.fn();
		renderTree({ access: { mode: 'all' }, onChange });

		fireEvent.click(screen.getByRole('checkbox', { name: 'files folder access' }));
		expect(onChange).toHaveBeenCalledWith({ mode: 'restricted', grants: [] });
	});

	it('shows a nested file grant as partial and cascades the folder grant to descendants', () => {
		const onChange = vi.fn();
		renderTree({
			access: { mode: 'restricted', grants: [{ kind: 'file', path: 'analytics/dashboards/q3.html' }] },
			onChange,
		});

		expect(screen.getByRole('checkbox', { name: 'files folder access' }).getAttribute('data-state')).toBe(
			'indeterminate',
		);

		fireEvent.click(screen.getByRole('button', { name: 'Expand files folder' }));
		const analyticsAccess = screen.getByRole('checkbox', { name: 'analytics folder access' });
		expect(analyticsAccess.getAttribute('data-state')).toBe('indeterminate');
		expect(screen.getAllByText('Partial')).toHaveLength(2);

		fireEvent.click(analyticsAccess);
		expect(onChange).toHaveBeenCalledWith({
			mode: 'restricted',
			grants: [
				{ kind: 'folder', path: 'analytics' },
				{ kind: 'file', path: 'analytics/dashboards/q3.html' },
			],
		});
	});

	it('filters paths, retains ancestors, and keeps the granted file selected', () => {
		const access: FilesContextAccess = {
			mode: 'restricted',
			grants: [{ kind: 'file', path: 'analytics/dashboards/q3.html' }],
		};
		renderTree({ search: 'q3', searching: true, access });

		expect(screen.getByText('files')).toBeTruthy();
		expect(screen.getByText('analytics/dashboards')).toBeTruthy();
		expect(screen.getByText('q3.html')).toBeTruthy();
		expect(screen.queryByText('overview.md')).toBeNull();
		expect(screen.queryByText('finance')).toBeNull();
		expect(screen.queryByText('readme.md')).toBeNull();

		const file = screen.getByRole('checkbox', { name: 'q3.html file access' });
		expect(file.getAttribute('data-state')).toBe('checked');
		expect(getFilesContextSelectionCount(access, entries)).toBe(1);
	});

	it('keeps missing and error roots visible with compact status', () => {
		const { rerender } = renderTree({ entries: [], syncState: 'missing', search: 'finance', searching: true });
		expect(screen.getByText('Missing')).toBeTruthy();

		rerender(
			<FilesContextTreeRoot
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

	it('renders an empty catalog without crashing', () => {
		renderTree({ entries: [], syncState: 'ready' });

		expect(screen.getByText('Empty')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Expand files folder' }));
		expect(screen.getByText('The project has no files.')).toBeTruthy();
	});

	it('keeps grants missing from the catalog surfaced as removable', () => {
		const access: FilesContextAccess = { mode: 'restricted', grants: [{ kind: 'file', path: 'deleted.md' }] };

		expect(getUnavailableFilesContextGrants(access, entries)).toEqual([{ kind: 'file', path: 'deleted.md' }]);
		expect(getFilesContextSelectionCount(access, entries)).toBe(0);

		const onChange = vi.fn();
		render(
			<UnavailableFilesGrants
				grants={[{ kind: 'file', path: 'deleted.md' }]}
				access={access}
				onChange={onChange}
			/>,
		);

		expect(screen.getByText('Unavailable file selections')).toBeTruthy();
		expect(screen.getByText('deleted.md')).toBeTruthy();

		fireEvent.click(screen.getByRole('checkbox', { name: 'Remove unavailable file deleted.md' }));
		expect(onChange).toHaveBeenCalledWith({ mode: 'restricted', grants: [] });
	});

	it('keeps exact grant identity and computes counts', () => {
		const access = toggleFilesContextGrant(
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
		expect(getFilesContextSelectionCount(access, entries)).toBe(1);
		expect(getFilesContextSelectionSummary(access, entries)).toBe('1 file · 1 unavailable');
		expect(
			getUnavailableFilesContextGrants(
				{ mode: 'restricted', grants: [{ kind: 'file', path: 'deleted.md' }] },
				entries,
			),
		).toEqual([{ kind: 'file', path: 'deleted.md' }]);
		expect(filterFilesContextEntries(entries, 'DASHBOARDS')).toEqual([
			{ kind: 'folder', path: 'analytics' },
			{ kind: 'folder', path: 'analytics/dashboards' },
			{ kind: 'file', path: 'analytics/dashboards/q3.html' },
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
	entries?: FilesContextCatalogEntry[];
	access?: FilesContextAccess;
	search?: string;
	searching?: boolean;
	syncState?: 'missing' | 'ready';
	isLoading?: boolean;
	isError?: boolean;
	disabled?: boolean;
	onRetry?: () => void;
	onChange?: (access: FilesContextAccess) => void;
} = {}) {
	return render(
		<FilesContextTreeRoot
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
