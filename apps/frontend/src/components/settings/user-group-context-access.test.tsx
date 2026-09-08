// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	filterDatabaseContextObjects,
	getDatabaseContextSelectionSummary,
	getEverythingCheckboxState,
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

beforeEach(() => {
	mocks.useQuery.mockReturnValue({
		isLoading: false,
		isError: false,
		data: { syncState: 'ready', objects: [] },
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
		expect(screen.getByRole('checkbox')).toBeTruthy();
		expect(screen.getByText('Loading synced database tables...')).toBeTruthy();
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
		expect(screen.getByRole('checkbox')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
	});

	it('derives the Everything checkbox state from current access', () => {
		expect(getEverythingCheckboxState({ mode: 'all' })).toBe(true);
		expect(getEverythingCheckboxState(empty)).toBe(false);
		expect(getEverythingCheckboxState({ mode: 'restricted', grants: [users] })).toBe('indeterminate');
	});

	it('keeps individual table grants distinct even when every current table is selected', () => {
		const access = toggleDatabaseTableGrant(toggleDatabaseTableGrant(empty, users, true), orders, true);

		expect(access).toEqual({
			mode: 'restricted',
			grants: [orders, users],
		});
		expect(getDatabaseContextSelectionSummary(access)).toBe('0 schemas, 2 tables');
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
		const objects = [
			{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' },
			{ databaseType: 'snowflake', database: 'warehouse', schema: 'raw', table: 'events' },
		];

		expect(filterDatabaseContextObjects(objects, 'WARE')).toEqual([objects[1]]);
		expect(filterDatabaseContextObjects(objects, 'public')).toEqual([objects[0]]);
		expect(filterDatabaseContextObjects(objects, '')).toEqual(objects);
	});
});
