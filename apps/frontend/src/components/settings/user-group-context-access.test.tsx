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
import type { DatabaseContextAccess, DatabaseSchemaGrant, DatabaseTableGrant } from '@nao/shared';

const mocks = vi.hoisted(() => ({ useQuery: vi.fn() }));

vi.mock('@/main', () => ({ trpc: { userGroup: { contextCatalog: { queryOptions: vi.fn() } } } }));
vi.mock('@tanstack/react-query', () => ({ useQuery: mocks.useQuery }));

const schema: DatabaseSchemaGrant = {
	kind: 'schema',
	databaseType: 'postgres',
	database: 'app',
	schema: 'public',
};
const users: DatabaseTableGrant = { ...schema, kind: 'table', table: 'users' };
const orders: DatabaseTableGrant = { ...schema, kind: 'table', table: 'orders' };
const empty: DatabaseContextAccess = { mode: 'restricted', grants: [] };
const objects = [
	{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' },
	{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'orders' },
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
		expect(screen.getByText('Loading synced database tables...')).toBeTruthy();
	});

	it('shows catalog states but hides search while Everything is selected', () => {
		mocks.useQuery.mockReturnValue({
			isLoading: true,
			isError: false,
			data: undefined,
			refetch: vi.fn(),
		});

		render(<UserGroupContextAccess databaseAccess={{ mode: 'all' }} onDatabaseAccessChange={vi.fn()} />);

		expect(screen.getByRole('button', { name: /Everything/ }).getAttribute('aria-pressed')).toBe('true');
		expect(screen.getByText('Loading synced database tables...')).toBeTruthy();
		expect(screen.queryByRole('textbox', { name: 'Search database context' })).toBeNull();
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
		const search = screen.getByRole('textbox', { name: 'Search database context' });
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
		expect(screen.queryByRole('textbox', { name: 'Search database context' })).toBeNull();
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
		expect(screen.getByRole('textbox', { name: 'Search database context' })).toBeTruthy();
		expect(screen.getByText('0 tables')).toBeTruthy();
	});

	it('changes grants only from checkboxes', () => {
		const onChange = vi.fn();
		render(<UserGroupContextAccess databaseAccess={empty} onDatabaseAccessChange={onChange} />);

		fireEvent.click(screen.getByRole('button', { name: 'Expand app/public folder' }));
		expect(onChange).not.toHaveBeenCalled();

		fireEvent.click(screen.getByText('app/public').closest('button')!);
		expect(onChange).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole('checkbox', { name: 'app/public schema access' }));
		expect(onChange).toHaveBeenCalledWith({ mode: 'restricted', grants: [schema] });
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
		render(<StatefulContextAccess initialAccess={{ mode: 'all' }} />);

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
		render(<StatefulContextAccess initialAccess={{ mode: 'restricted', grants: [schema] }} />);
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

		fireEvent.change(screen.getByRole('textbox', { name: 'Search database context' }), {
			target: { value: 'users' },
		});

		expect(screen.getByText('app/public')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Collapse app/public folder' }).getAttribute('aria-expanded')).toBe(
			'true',
		);
		expect(screen.getByRole('checkbox', { name: 'users table access' })).toBeTruthy();
		expect(screen.queryByRole('checkbox', { name: 'orders table access' })).toBeNull();
	});

	it('keeps individual table grants distinct even when every current table is selected', () => {
		const access = toggleDatabaseTableGrant(toggleDatabaseTableGrant(empty, users, true), orders, true);

		expect(access).toEqual({
			mode: 'restricted',
			grants: [orders, users],
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
		expect(getDatabaseContextTableSelectionSummary({ mode: 'restricted', grants: [users] }, objects)).toBe(
			'1 table',
		);
		expect(getDatabaseContextTableSelectionSummary({ mode: 'restricted', grants: [schema] }, objects)).toBe(
			'2 tables',
		);
		expect(getDatabaseContextTableSelectionSummary({ mode: 'restricted', grants: [schema, users] }, objects)).toBe(
			'2 tables',
		);
		expect(getDatabaseContextTableSelectionSummary({ mode: 'all' }, objects)).toBe('2 tables');
		expect(getDatabaseContextTableSelectionSummary({ mode: 'restricted', grants: [stale] }, objects)).toBe(
			'0 tables',
		);
	});

	it('represents schema selection dynamically and removes redundant table grants', () => {
		const tables = toggleDatabaseTableGrant(toggleDatabaseTableGrant(empty, users, true), orders, true);
		const selected = toggleDatabaseSchemaGrant(tables, schema, true);

		expect(selected).toEqual({ mode: 'restricted', grants: [schema] });
		expect(toggleDatabaseSchemaGrant(selected, schema, false)).toEqual(empty);
	});

	it('does not change descendants while all access is selected', () => {
		const all: DatabaseContextAccess = { mode: 'all' };

		expect(toggleDatabaseSchemaGrant(all, schema, false)).toBe(all);
		expect(toggleDatabaseTableGrant(all, users, false)).toBe(all);
	});

	it('finds stale schema and table selections', () => {
		const access: DatabaseContextAccess = {
			mode: 'restricted',
			grants: [
				schema,
				{ kind: 'table', databaseType: 'snowflake', database: 'warehouse', schema: 'raw', table: 'events' },
			],
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

function setCatalogObjects(catalogObjects: typeof objects) {
	mocks.useQuery.mockReturnValue({
		isLoading: false,
		isError: false,
		data: { syncState: 'ready', objects: catalogObjects },
		refetch: vi.fn(),
	});
}
