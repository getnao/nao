import { describe, expect, it } from 'vitest';

import {
	ALL_DATABASE_CONTEXT_ACCESS,
	EMPTY_DATABASE_CONTEXT_ACCESS,
	normalizeDatabaseContextAccess,
	parseStoredDatabaseContextAccess,
	serializeDatabaseContextAccess,
	unionDatabaseContextAccess,
} from './user-group-context';

describe('user group database context access', () => {
	it('normalizes type casing, duplicates, and order while preserving source names', () => {
		expect(
			normalizeDatabaseContextAccess({
				mode: 'restricted',
				grants: [
					{ kind: 'table', databaseType: 'SnowFlake', database: 'Warehouse', schema: 'Raw', table: 'Events' },
					{ kind: 'schema', databaseType: 'POSTGRES', database: 'App', schema: 'public' },
					{ kind: 'table', databaseType: 'snowflake', database: 'Warehouse', schema: 'Raw', table: 'Events' },
				],
			}),
		).toEqual({
			mode: 'restricted',
			grants: [
				{ kind: 'schema', databaseType: 'postgres', database: 'App', schema: 'public' },
				{ kind: 'table', databaseType: 'snowflake', database: 'Warehouse', schema: 'Raw', table: 'Events' },
			],
		});
	});

	it('parses and serializes the versioned document', () => {
		const access = {
			mode: 'restricted' as const,
			grants: [{ kind: 'schema' as const, databaseType: 'POSTGRES', database: 'app', schema: 'public' }],
		};

		expect(parseStoredDatabaseContextAccess(serializeDatabaseContextAccess(access))).toEqual({
			mode: 'restricted',
			grants: [{ kind: 'schema', databaseType: 'postgres', database: 'app', schema: 'public' }],
		});
	});

	it('fails closed for malformed documents and grants', () => {
		expect(parseStoredDatabaseContextAccess(null)).toEqual(EMPTY_DATABASE_CONTEXT_ACCESS);
		expect(parseStoredDatabaseContextAccess({ version: 2, access: { mode: 'all' } })).toEqual(
			EMPTY_DATABASE_CONTEXT_ACCESS,
		);
		expect(
			parseStoredDatabaseContextAccess({
				version: 1,
				access: {
					mode: 'restricted',
					grants: [{ kind: 'table', databaseType: 'postgres', database: 'app', schema: 'public' }],
				},
			}),
		).toEqual(EMPTY_DATABASE_CONTEXT_ACCESS);
	});

	it('lets all access dominate unions and otherwise normalizes grants', () => {
		expect(unionDatabaseContextAccess([{ mode: 'restricted', grants: [] }, { mode: 'all' }])).toEqual(
			ALL_DATABASE_CONTEXT_ACCESS,
		);

		expect(
			unionDatabaseContextAccess([
				{
					mode: 'restricted',
					grants: [
						{ kind: 'table', databaseType: 'POSTGRES', database: 'app', schema: 'public', table: 'users' },
					],
				},
				{
					mode: 'restricted',
					grants: [
						{ kind: 'table', databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' },
					],
				},
			]),
		).toEqual({
			mode: 'restricted',
			grants: [{ kind: 'table', databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' }],
		});
	});
});
