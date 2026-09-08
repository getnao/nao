// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	filterDatabaseContextObjects,
	getDatabaseContextTableSelectionSummary,
	getUnavailableDatabaseContextGrants,
	toggleDatabaseSchemaGrant,
	toggleDatabaseTableGrant,
	UserGroupContextAccess,
} from './user-group-context-access';
import type { DatabaseContextAccess, DatabaseSchemaGrant, DatabaseTableGrant, DocsContextAccess } from '@nao/shared';

const mocks = vi.hoisted(() => ({
	useQuery: vi.fn(),
	databaseQueryOptions: { resource: 'database' },
	docsQueryOptions: { resource: 'docs' },
}));

vi.mock('@/main', () => ({
	trpc: {
		userGroup: {
			contextCatalog: { queryOptions: vi.fn(() => mocks.databaseQueryOptions) },
			docsContextCatalog: { queryOptions: vi.fn(() => mocks.docsQueryOptions) },
		},
	},
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: mocks.useQuery }));

const schema: DatabaseSchemaGrant = {
	kind: 'schema',
	databaseType: 'postgres',
	database: 'app',
	schema: 'public',
};
const users: DatabaseTableGrant = { ...schema, kind: 'table', table: 'users' };
const orders: DatabaseTableGrant = { ...schema, kind: 'table', table: 'orders' };
const empty: DatabaseContextAccess = { mode: 'restricted', strict: true, grants: [], patterns: [] };
const objects = [
	{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' },
	{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'orders' },
];
const docsEntries = [
	{ kind: 'folder' as const, path: 'finance' },
	{ kind: 'file' as const, path: 'finance/kpis.md' },
	{ kind: 'file' as const, path: 'readme.md' },
];

beforeEach(() => {
	mocks.useQuery.mockReturnValue({
		isLoading: false,
		isError: false,
		data: { syncState: 'ready', objects },
		refetch: vi.fn(),
	});
});

afterEach(cleanup);

describe('user group context access selection', () => {
	it('keeps the access controls visible while the catalog loads', () => {
		mocks.useQuery.mockReturnValue({
			isLoading: true,
			isError: false,
			data: undefined,
			refetch: vi.fn(),
		});

		render(<UserGroupContextAccess databaseAccess={empty} onDatabaseAccessChange={vi.fn()} />);

		expect(screen.getByText(/Choose which synced database tables/)).toBeTruthy();
		expect(screen.getByRole('button', { name: /Everything/ })).toBeTruthy();
		expect(screen.getByRole('button', { name: /Specific selection/ })).toBeTruthy();
		expect(screen.getByText('Loading...')).toBeTruthy();
	});

	it('shows catalog states but hides search while Everything is selected', () => {
		mocks.useQuery.mockReturnValue({
			isLoading: true,
			isError: false,
			data: undefined,
			refetch: vi.fn(),
		});

		render(
			<UserGroupContextAccess databaseAccess={{ mode: 'all', strict: true }} onDatabaseAccessChange={vi.fn()} />,
		);

		expect(screen.getByRole('button', { name: /Everything/ }).getAttribute('aria-pressed')).toBe('true');
		expect(screen.getByText('Loading...')).toBeTruthy();
		expect(screen.queryByRole('textbox', { name: 'Search context' })).toBeNull();
	});

	it('keeps the access controls visible when the catalog fails', () => {
		mocks.useQuery.mockReturnValue({
			isLoading: false,
			isError: true,
			data: undefined,
			refetch: vi.fn(),
		});

		render(<UserGroupContextAccess databaseAccess={empty} onDatabaseAccessChange={vi.fn()} />);

		expect(screen.getByText(/Choose which synced database tables/)).toBeTruthy();
		expect(screen.getByRole('button', { name: /Everything/ })).toBeTruthy();
		expect(screen.getByRole('button', { name: /Specific selection/ })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
	});

	it('switches modes and shows the full inherited tree for Everything', () => {
		render(<StatefulContextAccess />);

		const everything = screen.getByRole('button', { name: /Everything/ });
		const specific = screen.getByRole('button', { name: /Specific selection/ });
		const search = screen.getByRole('textbox', { name: 'Search context' });
		expect(everything.getAttribute('type')).toBe('button');
		expect(specific.getAttribute('type')).toBe('button');
		expect(everything.getAttribute('aria-pressed')).toBe('false');
		expect(specific.getAttribute('aria-pressed')).toBe('true');
		fireEvent.change(search, { target: { value: 'users' } });
		expect(screen.getByRole('checkbox', { name: 'users table access' })).toBeTruthy();
		expect(screen.queryByRole('checkbox', { name: 'orders table access' })).toBeNull();

		fireEvent.click(everything);
		expect(everything.getAttribute('aria-pressed')).toBe('true');
		expect(specific.getAttribute('aria-pressed')).toBe('false');
		expect(screen.queryByRole('textbox', { name: 'Search context' })).toBeNull();
		expect(screen.getByText('app/public')).toBeTruthy();
		expect(screen.getByText('2 tables')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Expand app/public folder' }));
		const schemaAccess = screen.getByRole('checkbox', { name: 'app/public schema access' });
		const usersAccess = screen.getByRole('checkbox', { name: 'users table access' });
		const ordersAccess = screen.getByRole('checkbox', { name: 'orders table access' });
		expect(schemaAccess.getAttribute('data-state')).toBe('checked');
		expect(usersAccess.getAttribute('data-state')).toBe('checked');
		expect(ordersAccess.getAttribute('data-state')).toBe('checked');
		expect(schemaAccess.hasAttribute('disabled')).toBe(true);
		expect(usersAccess.hasAttribute('disabled')).toBe(true);
		expect(ordersAccess.hasAttribute('disabled')).toBe(true);

		fireEvent.click(specific);
		expect(everything.getAttribute('aria-pressed')).toBe('false');
		expect(specific.getAttribute('aria-pressed')).toBe('true');
		expect(screen.getByRole('textbox', { name: 'Search context' })).toBeTruthy();
		expect(screen.getByText('0 tables')).toBeTruthy();
	});

	it('shows strict mode in both modes and preserves it while switching modes', () => {
		render(
			<StatefulContextAccess
				initialAccess={{ mode: 'restricted', strict: false, grants: [users], patterns: ['public.*'] }}
			/>,
		);

		const strictMode = screen.getByRole('switch', { name: 'Strict mode' });
		expect(strictMode.getAttribute('aria-checked')).toBe('false');
		expect(strictMode.closest('.rounded-lg')?.className).toContain('border');

		fireEvent.click(screen.getByRole('button', { name: /Everything/ }));
		expect(screen.getByRole('switch', { name: 'Strict mode' }).getAttribute('aria-checked')).toBe('false');

		fireEvent.click(screen.getByRole('button', { name: /Specific selection/ }));
		expect(screen.getByRole('switch', { name: 'Strict mode' }).getAttribute('aria-checked')).toBe('false');
		expect(screen.getByText('0 tables')).toBeTruthy();

		fireEvent.click(screen.getByRole('switch', { name: 'Strict mode' }));
		expect(screen.getByRole('switch', { name: 'Strict mode' }).getAttribute('aria-checked')).toBe('true');
	});

	it('renders one combined filesystem with shared mode, search, and counts', () => {
		setCombinedCatalogs();
		render(<StatefulCombinedContextAccess />);

		expect(screen.getByText(/database tables and docs/)).toBeTruthy();
		expect(screen.queryByRole('heading', { name: 'Database tables' })).toBeNull();
		expect(screen.queryByRole('heading', { name: 'Docs' })).toBeNull();
		expect(screen.getAllByTestId('combined-context-tree')).toHaveLength(1);
		expect(screen.getByText('0 tables · 0 docs')).toBeTruthy();
		expect(screen.getByText('docs')).toBeTruthy();

		fireEvent.change(screen.getByRole('textbox', { name: 'Search context' }), {
			target: { value: 'kpis' },
		});
		expect(screen.getByText('kpis.md')).toBeTruthy();
		expect(screen.queryByText('app/public')).toBeNull();

		fireEvent.click(screen.getByRole('checkbox', { name: 'docs folder access' }));
		expect(screen.getByText('0 tables · 2 docs')).toBeTruthy();
		expect(screen.getByRole('button', { name: /Specific selection/ }).getAttribute('aria-pressed')).toBe('true');
	});

	it('changes both policies only through the combined mode control and preserves mixed state', () => {
		setCombinedCatalogs();
		render(
			<StatefulCombinedContextAccess
				initialDatabaseAccess={{ mode: 'all', strict: false }}
				initialDocsAccess={{ mode: 'restricted', grants: [{ kind: 'file', path: 'readme.md' }] }}
			/>,
		);

		const everything = screen.getByRole('button', { name: /Everything/ });
		const specific = screen.getByRole('button', { name: /Specific selection/ });
		expect(specific.getAttribute('aria-pressed')).toBe('true');
		fireEvent.click(specific);
		expect(screen.getByText('2 tables · 1 doc')).toBeTruthy();

		fireEvent.click(everything);
		expect(everything.getAttribute('aria-pressed')).toBe('true');
		expect(screen.queryByRole('textbox', { name: 'Search context' })).toBeNull();
		expect(screen.getByRole('checkbox', { name: 'docs folder access' }).hasAttribute('disabled')).toBe(true);

		fireEvent.click(specific);
		expect(specific.getAttribute('aria-pressed')).toBe('true');
		expect(screen.getByText('0 tables · 0 docs')).toBeTruthy();
		expect(screen.getByRole('switch', { name: 'Strict mode' }).getAttribute('aria-checked')).toBe('false');
	});

	it('keeps docs usable when the database catalog fails', () => {
		mocks.useQuery.mockImplementation((options) =>
			options === mocks.docsQueryOptions
				? {
						isLoading: false,
						isError: false,
						data: { syncState: 'ready', entries: docsEntries },
						refetch: vi.fn(),
					}
				: { isLoading: false, isError: true, data: undefined, refetch: vi.fn() },
		);
		render(<StatefulCombinedContextAccess />);

		expect(screen.getByText('Failed to load')).toBeTruthy();
		expect(screen.getByText('docs')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Expand docs folder' }));
		expect(screen.getByText('finance')).toBeTruthy();
	});

	it('changes grants only from checkboxes', () => {
		const onChange = vi.fn();
		render(<UserGroupContextAccess databaseAccess={empty} onDatabaseAccessChange={onChange} />);

		fireEvent.click(screen.getByRole('button', { name: 'Expand app/public folder' }));
		expect(onChange).not.toHaveBeenCalled();

		fireEvent.click(screen.getByText('app/public').closest('button')!);
		expect(onChange).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole('checkbox', { name: 'app/public schema access' }));
		expect(onChange).toHaveBeenCalledWith({ mode: 'restricted', strict: true, grants: [schema], patterns: [] });
	});

	it('keeps schema unselected until its checkbox is explicitly selected', () => {
		render(<StatefulContextAccess />);
		fireEvent.click(screen.getByRole('button', { name: 'Expand app/public folder' }));

		const schemaAccess = screen.getByRole('checkbox', { name: 'app/public schema access' });
		const schemaRow = schemaAccess.parentElement!;
		const usersAccess = screen.getByRole('checkbox', { name: 'users table access' });
		const ordersAccess = screen.getByRole('checkbox', { name: 'orders table access' });
		fireEvent.click(usersAccess);
		fireEvent.click(ordersAccess);

		expect(usersAccess.getAttribute('data-state')).toBe('checked');
		expect(ordersAccess.getAttribute('data-state')).toBe('checked');
		expect(schemaAccess.getAttribute('data-state')).toBe('unchecked');
		expect(schemaRow.className).not.toContain('bg-primary');
		expect(screen.queryByText('Partial')).toBeNull();
		expect(screen.getByText('2 tables')).toBeTruthy();

		fireEvent.click(schemaAccess);
		expect(schemaAccess.getAttribute('data-state')).toBe('checked');
		expect(screen.getByRole('checkbox', { name: 'users table access' }).hasAttribute('disabled')).toBe(true);
		expect(screen.getByRole('checkbox', { name: 'orders table access' }).hasAttribute('disabled')).toBe(true);

		fireEvent.click(schemaAccess);
		expect(schemaAccess.getAttribute('data-state')).toBe('unchecked');
		expect(screen.getByRole('checkbox', { name: 'users table access' }).getAttribute('data-state')).toBe(
			'unchecked',
		);
	});

	it('renders explorer icons in checkbox row order', () => {
		const { container } = render(<StatefulContextAccess />);
		const schemaCheckbox = screen.getByRole('checkbox', { name: 'app/public schema access' });
		const schemaRow = schemaCheckbox.parentElement!;
		expect(schemaRow.children[0].getAttribute('aria-label')).toBe('Expand app/public folder');
		expect(schemaRow.children[0].className).toContain('size-4');
		expect(schemaRow.children[1]).toBe(schemaCheckbox);
		expect(schemaRow.children[2].querySelector('.tabler-icon-folder')).toBeTruthy();
		expect(schemaRow.className).toContain('gap-1');
		expect(schemaRow.className).toContain('w-full');
		expect(schemaRow.className).not.toMatch(/rounded|py-/);
		expect(schemaRow.parentElement?.parentElement?.className).not.toMatch(/px-|py-|space-y-/);

		fireEvent.click(screen.getByRole('button', { name: 'Expand app/public folder' }));
		const tableCheckbox = screen.getByRole('checkbox', { name: 'users table access' });
		const tableRow = tableCheckbox.parentElement!;
		expect(tableRow.children[0].className).toContain('size-4');
		expect(tableRow.children[1]).toBe(tableCheckbox);
		expect(tableRow.children[2].classList.contains('tabler-icon-table')).toBe(true);
		expect(tableRow.className).toContain('gap-1');
		expect(tableRow.className).toContain('w-full');
		expect(tableRow.className).not.toMatch(/rounded|py-/);
		expect(tableRow.parentElement?.parentElement?.className).not.toMatch(/pt-|space-y-/);
		expect(schemaRow.nextElementSibling).toBe(tableRow.parentElement?.parentElement);

		expect(container.querySelectorAll('.tabler-icon-folder')).toHaveLength(1);
		expect(container.querySelectorAll('.tabler-icon-table')).toHaveLength(2);
	});

	it('compacts a database with one schema into one folder row', () => {
		render(<StatefulContextAccess />);

		expect(screen.getByText('app/public')).toBeTruthy();
		expect(screen.queryByText('app')).toBeNull();
		expect(screen.queryByText('public')).toBeNull();
		expect(screen.getByText('postgres')).toBeTruthy();
	});

	it('keeps database and schema rows separate when schemas branch', () => {
		setCatalogObjects([
			...objects,
			{ databaseType: 'postgres', database: 'app', schema: 'audit', table: 'events' },
		]);
		render(<StatefulContextAccess />);

		fireEvent.click(screen.getByRole('button', { name: 'Expand app database' }));
		expect(screen.getByText('app')).toBeTruthy();
		expect(screen.getByText('public')).toBeTruthy();
		expect(screen.getByText('audit')).toBeTruthy();
		expect(screen.queryByText('app/public')).toBeNull();
	});

	it('highlights a branched database root in Everything mode', () => {
		setCatalogObjects([
			...objects,
			{ databaseType: 'postgres', database: 'app', schema: 'audit', table: 'events' },
		]);
		render(<StatefulContextAccess initialAccess={{ mode: 'all', strict: true }} />);

		const databaseRow = screen.getByRole('button', { name: 'Expand app database' });
		expect(databaseRow.className).toContain('bg-primary');
		expect(databaseRow.querySelector('.tabler-icon-folder')?.getAttribute('class')).toContain('text-primary');
		expect(screen.getByText('3 tables')).toBeTruthy();

		fireEvent.click(databaseRow);
		const publicSchema = screen.getByRole('checkbox', { name: 'public schema access' });
		expect(publicSchema.getAttribute('data-state')).toBe('checked');
		expect(publicSchema.hasAttribute('disabled')).toBe(true);
	});

	it('shows descendants inherited from a schema as selected and locked', () => {
		render(
			<StatefulContextAccess
				initialAccess={{ mode: 'restricted', strict: true, grants: [schema], patterns: [] }}
			/>,
		);
		fireEvent.click(screen.getByRole('button', { name: 'Expand app/public folder' }));

		const schemaAccess = screen.getByRole('checkbox', { name: 'app/public schema access' });
		const usersAccess = screen.getByRole('checkbox', { name: 'users table access' });
		expect(schemaAccess.getAttribute('data-state')).toBe('checked');
		expect(usersAccess.getAttribute('data-state')).toBe('checked');
		expect(schemaAccess.hasAttribute('disabled')).toBe(false);
		expect(usersAccess.hasAttribute('disabled')).toBe(true);
		expect(usersAccess.className).toContain('cursor-default');
		expect(screen.getAllByText('Inherited')).toHaveLength(2);
	});

	it('expands and collapses compact folders and opens them during search', () => {
		render(<StatefulContextAccess />);

		fireEvent.click(screen.getByRole('button', { name: 'Expand app/public folder' }));
		expect(screen.getByRole('checkbox', { name: 'users table access' })).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Collapse app/public folder' }));
		expect(screen.queryByRole('checkbox', { name: 'users table access' })).toBeNull();

		fireEvent.change(screen.getByRole('textbox', { name: 'Search context' }), {
			target: { value: 'users' },
		});

		expect(screen.getByText('app/public')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Collapse app/public folder' }).getAttribute('aria-expanded')).toBe(
			'true',
		);
		expect(screen.getByRole('checkbox', { name: 'users table access' })).toBeTruthy();
		expect(screen.queryByRole('checkbox', { name: 'orders table access' })).toBeNull();
	});

	it('previews a draft pattern and adds it with Enter', () => {
		render(<StatefulContextAccess />);
		fireEvent.click(screen.getByRole('button', { name: 'Expand app/public folder' }));

		const patternInput = screen.getByRole('textbox', { name: 'Dynamic table pattern' });
		const usersAccess = screen.getByRole('checkbox', { name: 'users table access' });
		fireEvent.change(patternInput, { target: { value: ' PUBLIC.u* ' } });

		expect(screen.getByText('1 current match · future matching tables are included')).toBeTruthy();
		expect(usersAccess.getAttribute('data-state')).toBe('unchecked');
		expect(usersAccess.hasAttribute('disabled')).toBe(false);
		expect(usersAccess.parentElement?.className).toContain('bg-primary/5');

		fireEvent.keyDown(patternInput, { key: 'Enter' });

		expect((patternInput as HTMLInputElement).value).toBe('');
		expect(screen.getByText('public.u*')).toBeTruthy();
		expect(screen.getAllByText('1 table')).toHaveLength(2);
		expect(usersAccess.getAttribute('data-state')).toBe('checked');
		expect(usersAccess.hasAttribute('disabled')).toBe(true);
		expect(usersAccess.getAttribute('title')).toContain('Remove the pattern');
	});

	it('adds and removes unmatched patterns without dropping them', () => {
		render(<StatefulContextAccess />);
		const patternInput = screen.getByRole('textbox', { name: 'Dynamic table pattern' });
		fireEvent.change(patternInput, { target: { value: ' Future.* ' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add pattern' }));

		expect(screen.getByText('future.*')).toBeTruthy();
		expect(screen.getAllByText('0 tables')).toHaveLength(2);

		fireEvent.click(screen.getByRole('button', { name: 'Remove dynamic pattern future.*' }));
		expect(screen.queryByText('future.*')).toBeNull();
	});

	it('shows stored pattern matches as selected and keeps patterns out of Everything mode', () => {
		const { unmount } = render(
			<StatefulContextAccess
				initialAccess={{ mode: 'restricted', strict: true, grants: [], patterns: ['public.*'] }}
			/>,
		);
		fireEvent.click(screen.getByRole('button', { name: 'Expand app/public folder' }));

		expect(screen.getByRole('checkbox', { name: 'users table access' }).hasAttribute('disabled')).toBe(true);
		expect(screen.getByRole('checkbox', { name: 'orders table access' }).hasAttribute('disabled')).toBe(true);
		expect(screen.getAllByText('2 tables')).toHaveLength(2);

		unmount();
		render(<StatefulContextAccess initialAccess={{ mode: 'all', strict: true }} />);
		expect(screen.queryByRole('textbox', { name: 'Dynamic table pattern' })).toBeNull();
	});

	it('keeps individual table grants distinct even when every current table is selected', () => {
		const access = toggleDatabaseTableGrant(toggleDatabaseTableGrant(empty, users, true), orders, true);

		expect(access).toEqual({
			mode: 'restricted',
			strict: true,
			grants: [orders, users],
			patterns: [],
		});
		expect(getDatabaseContextTableSelectionSummary(access, objects)).toBe('2 tables');
	});

	it('counts only matching synced tables without overlap', () => {
		const stale: DatabaseTableGrant = {
			kind: 'table',
			databaseType: 'snowflake',
			database: 'warehouse',
			schema: 'raw',
			table: 'events',
		};

		expect(getDatabaseContextTableSelectionSummary(empty, objects)).toBe('0 tables');
		expect(
			getDatabaseContextTableSelectionSummary(
				{ mode: 'restricted', strict: true, grants: [users], patterns: [] },
				objects,
			),
		).toBe('1 table');
		expect(
			getDatabaseContextTableSelectionSummary(
				{ mode: 'restricted', strict: true, grants: [schema], patterns: [] },
				objects,
			),
		).toBe('2 tables');
		expect(
			getDatabaseContextTableSelectionSummary(
				{ mode: 'restricted', strict: true, grants: [schema, users], patterns: [] },
				objects,
			),
		).toBe('2 tables');
		expect(getDatabaseContextTableSelectionSummary({ mode: 'all', strict: true }, objects)).toBe('2 tables');
		expect(
			getDatabaseContextTableSelectionSummary(
				{ mode: 'restricted', strict: true, grants: [stale], patterns: [] },
				objects,
			),
		).toBe('0 tables');
		expect(
			getDatabaseContextTableSelectionSummary(
				{ mode: 'restricted', strict: true, grants: [users], patterns: ['public.*'] },
				objects,
			),
		).toBe('2 tables');
	});

	it('represents schema selection dynamically and removes redundant table grants', () => {
		const tables = toggleDatabaseTableGrant(toggleDatabaseTableGrant(empty, users, true), orders, true);
		const selected = toggleDatabaseSchemaGrant(tables, schema, true);

		expect(selected).toEqual({ mode: 'restricted', strict: true, grants: [schema], patterns: [] });
		expect(toggleDatabaseSchemaGrant(selected, schema, false)).toEqual(empty);
	});

	it('does not change descendants while all access is selected', () => {
		const all: DatabaseContextAccess = { mode: 'all', strict: true };

		expect(toggleDatabaseSchemaGrant(all, schema, false)).toBe(all);
		expect(toggleDatabaseTableGrant(all, users, false)).toBe(all);
	});

	it('finds stale schema and table selections', () => {
		const access: DatabaseContextAccess = {
			mode: 'restricted',
			strict: true,
			grants: [
				schema,
				{ kind: 'table', databaseType: 'snowflake', database: 'warehouse', schema: 'raw', table: 'events' },
			],
			patterns: [],
		};

		expect(
			getUnavailableDatabaseContextGrants(access, [
				{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'orders' },
			]),
		).toEqual([
			{ kind: 'table', databaseType: 'snowflake', database: 'warehouse', schema: 'raw', table: 'events' },
		]);
	});

	it('searches source type, database, schema, and table without changing objects', () => {
		const searchObjects = [
			{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' },
			{ databaseType: 'snowflake', database: 'warehouse', schema: 'raw', table: 'events' },
		];

		expect(filterDatabaseContextObjects(searchObjects, 'WARE')).toEqual([searchObjects[1]]);
		expect(filterDatabaseContextObjects(searchObjects, 'public')).toEqual([searchObjects[0]]);
		expect(filterDatabaseContextObjects(searchObjects, '')).toEqual(searchObjects);
	});
});

function StatefulContextAccess({ initialAccess = empty }: { initialAccess?: DatabaseContextAccess }) {
	const [access, setAccess] = useState(initialAccess);
	return <UserGroupContextAccess databaseAccess={access} onDatabaseAccessChange={setAccess} />;
}

function StatefulCombinedContextAccess({
	initialDatabaseAccess = empty,
	initialDocsAccess = { mode: 'restricted', grants: [] },
}: {
	initialDatabaseAccess?: DatabaseContextAccess;
	initialDocsAccess?: DocsContextAccess;
}) {
	const [databaseAccess, setDatabaseAccess] = useState(initialDatabaseAccess);
	const [docsAccess, setDocsAccess] = useState(initialDocsAccess);
	return (
		<UserGroupContextAccess
			databaseAccess={databaseAccess}
			docsAccess={docsAccess}
			onDatabaseAccessChange={setDatabaseAccess}
			onDocsAccessChange={setDocsAccess}
		/>
	);
}

function setCatalogObjects(catalogObjects: typeof objects) {
	mocks.useQuery.mockReturnValue({
		isLoading: false,
		isError: false,
		data: { syncState: 'ready', objects: catalogObjects },
		refetch: vi.fn(),
	});
}

function setCombinedCatalogs() {
	mocks.useQuery.mockImplementation((options) =>
		options === mocks.docsQueryOptions
			? {
					isLoading: false,
					isError: false,
					data: { syncState: 'ready', entries: docsEntries },
					refetch: vi.fn(),
				}
			: {
					isLoading: false,
					isError: false,
					data: { syncState: 'ready', objects },
					refetch: vi.fn(),
				},
	);
}
