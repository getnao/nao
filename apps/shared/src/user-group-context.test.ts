import { describe, expect, it } from 'vitest';

import {
	ALL_DATABASE_CONTEXT_ACCESS,
	ALL_DOCS_CONTEXT_ACCESS,
	EMPTY_DATABASE_CONTEXT_ACCESS,
	EMPTY_DOCS_CONTEXT_ACCESS,
	isDatabaseContextTableGranted,
	isDocsContextFileGranted,
	matchesDatabaseContextPattern,
	mayTraverseDocsContextDirectory,
	normalizeDatabaseContextAccess,
	normalizeDocsContextAccess,
	normalizeDocsContextPath,
	parseDocsContextAccess,
	parseStoredDatabaseContextAccess,
	parseStoredUserGroupContextAccess,
	serializeDatabaseContextAccess,
	serializeUserGroupContextAccess,
	unionDatabaseContextAccess,
	unionDocsContextAccess,
} from './user-group-context';

describe('user group database context access', () => {
	it('normalizes type casing, duplicates, and order while preserving source names', () => {
		expect(
			normalizeDatabaseContextAccess({
				mode: 'restricted',
				strict: false,
				grants: [
					{ kind: 'table', databaseType: 'SnowFlake', database: 'Warehouse', schema: 'Raw', table: 'Events' },
					{ kind: 'schema', databaseType: 'POSTGRES', database: 'App', schema: 'public' },
					{ kind: 'table', databaseType: 'snowflake', database: 'Warehouse', schema: 'Raw', table: 'Events' },
				],
				patterns: [' Sales.Customer_* ', 'main.*', '', 'sales.customer_*'],
			}),
		).toEqual({
			mode: 'restricted',
			strict: false,
			grants: [
				{ kind: 'schema', databaseType: 'postgres', database: 'App', schema: 'public' },
				{ kind: 'table', databaseType: 'snowflake', database: 'Warehouse', schema: 'Raw', table: 'Events' },
			],
			patterns: ['main.*', 'sales.customer_*'],
		});
	});

	it('serializes version 3 with normalized patterns and strict mode', () => {
		const access = {
			mode: 'restricted' as const,
			strict: false,
			grants: [{ kind: 'schema' as const, databaseType: 'POSTGRES', database: 'app', schema: 'public' }],
			patterns: [' PUBLIC.User* ', 'public.user*'],
		};

		const storedAccess = serializeDatabaseContextAccess(access);
		expect(storedAccess).toEqual({
			version: 3,
			access: {
				mode: 'restricted',
				strict: false,
				grants: [{ kind: 'schema', databaseType: 'postgres', database: 'app', schema: 'public' }],
				patterns: ['public.user*'],
			},
		});
		expect(parseStoredDatabaseContextAccess(storedAccess)).toEqual(storedAccess.access);
	});

	it('parses version 1 restricted access with empty patterns', () => {
		expect(
			parseStoredDatabaseContextAccess({
				version: 1,
				access: {
					mode: 'restricted',
					grants: [{ kind: 'schema', databaseType: 'POSTGRES', database: 'app', schema: 'public' }],
				},
			}),
		).toEqual({
			mode: 'restricted',
			strict: true,
			grants: [{ kind: 'schema', databaseType: 'postgres', database: 'app', schema: 'public' }],
			patterns: [],
		});
	});

	it('migrates version 2 access with strict mode enabled', () => {
		expect(
			parseStoredDatabaseContextAccess({
				version: 2,
				access: { mode: 'all' },
			}),
		).toEqual({ mode: 'all', strict: true });
		expect(
			parseStoredDatabaseContextAccess({
				version: 2,
				access: { mode: 'restricted', grants: [], patterns: [' Sales.* '] },
			}),
		).toEqual({ mode: 'restricted', strict: true, grants: [], patterns: ['sales.*'] });
	});

	it('fails closed for malformed documents and grants', () => {
		expect(parseStoredDatabaseContextAccess(null)).toEqual(EMPTY_DATABASE_CONTEXT_ACCESS);
		expect(parseStoredDatabaseContextAccess({ version: 3, access: { mode: 'all' } })).toEqual(
			EMPTY_DATABASE_CONTEXT_ACCESS,
		);
		expect(parseStoredDatabaseContextAccess({ version: 3, access: { mode: 'all', strict: 'yes' } })).toEqual(
			EMPTY_DATABASE_CONTEXT_ACCESS,
		);
		expect(
			parseStoredDatabaseContextAccess({
				version: 2,
				access: {
					mode: 'restricted',
					grants: [{ kind: 'table', databaseType: 'postgres', database: 'app', schema: 'public' }],
					patterns: [],
				},
			}),
		).toEqual(EMPTY_DATABASE_CONTEXT_ACCESS);
		expect(
			parseStoredDatabaseContextAccess({
				version: 2,
				access: { mode: 'restricted', grants: [], patterns: [42] },
			}),
		).toEqual(EMPTY_DATABASE_CONTEXT_ACCESS);
	});

	it('lets all access dominate unions while strict mode uses OR semantics', () => {
		expect(
			unionDatabaseContextAccess([
				{ mode: 'restricted', strict: true, grants: [], patterns: [] },
				{ mode: 'all', strict: false },
			]),
		).toEqual(ALL_DATABASE_CONTEXT_ACCESS);

		expect(
			unionDatabaseContextAccess([
				{
					mode: 'restricted',
					strict: false,
					grants: [
						{ kind: 'table', databaseType: 'POSTGRES', database: 'app', schema: 'public', table: 'users' },
					],
					patterns: [' SALES.* '],
				},
				{
					mode: 'restricted',
					strict: true,
					grants: [
						{ kind: 'table', databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' },
					],
					patterns: ['sales.*', 'main.events'],
				},
			]),
		).toEqual({
			mode: 'restricted',
			strict: true,
			grants: [{ kind: 'table', databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' }],
			patterns: ['main.events', 'sales.*'],
		});
	});

	it('matches shell-style patterns against anchored schema.table names', () => {
		expect(matchesDatabaseContextPattern('MAIN.*', { schema: 'main', table: 'users' })).toBe(true);
		expect(matchesDatabaseContextPattern('main.user?', { schema: 'main', table: 'users' })).toBe(true);
		expect(matchesDatabaseContextPattern('main.user?', { schema: 'main', table: 'users_old' })).toBe(false);
		expect(matchesDatabaseContextPattern('main.[uo]sers', { schema: 'main', table: 'users' })).toBe(true);
		expect(matchesDatabaseContextPattern('main.[a-z]sers', { schema: 'main', table: 'users' })).toBe(true);
		expect(matchesDatabaseContextPattern('main.[!a]sers', { schema: 'main', table: 'users' })).toBe(true);
		expect(matchesDatabaseContextPattern('main.[^u]sers', { schema: 'main', table: 'users' })).toBe(false);
		expect(matchesDatabaseContextPattern('main.users', { schema: 'mainx', table: 'users' })).toBe(false);
		expect(matchesDatabaseContextPattern('main.users', { schema: 'main', table: 'users.backup' })).toBe(false);
		expect(matchesDatabaseContextPattern('main.user.name', { schema: 'main', table: 'userxname' })).toBe(false);
	});

	it('supports schema shorthand and treats malformed character classes literally', () => {
		expect(matchesDatabaseContextPattern('main', { schema: 'main', table: 'anything' })).toBe(true);
		expect(matchesDatabaseContextPattern('main.[z-a]', { schema: 'main', table: '[z-a]' })).toBe(true);
		expect(matchesDatabaseContextPattern('main.[users', { schema: 'main', table: '[users' })).toBe(true);
	});

	it('grants concrete tables through explicit grants or patterns across databases', () => {
		const table = {
			databaseType: 'POSTGRES',
			database: 'app',
			schema: 'sales',
			table: 'customer_orders',
		};
		expect(
			isDatabaseContextTableGranted(
				{ mode: 'restricted', strict: false, grants: [], patterns: ['sales.customer_*'] },
				table,
			),
		).toBe(true);
		expect(
			isDatabaseContextTableGranted(
				{
					mode: 'restricted',
					strict: true,
					grants: [
						{ kind: 'table', databaseType: 'postgres', database: 'app', schema: 'sales', table: 'orders' },
					],
					patterns: [],
				},
				{ ...table, table: 'orders' },
			),
		).toBe(true);
		expect(
			isDatabaseContextTableGranted(
				{ mode: 'restricted', strict: true, grants: [], patterns: ['main.*'] },
				table,
			),
		).toBe(false);
	});
});

describe('user group docs context access', () => {
	it('serializes v4 and preserves independent database and docs policies', () => {
		const stored = serializeUserGroupContextAccess(
			{ mode: 'all', strict: false },
			{
				mode: 'restricted',
				grants: [
					{ kind: 'file', path: ' finance/kpis.md ' },
					{ kind: 'folder', path: 'finance' },
				],
			},
		);

		expect(stored).toEqual({
			version: 4,
			databaseAccess: { mode: 'all', strict: false },
			docsAccess: {
				mode: 'restricted',
				grants: [
					{ kind: 'folder', path: 'finance' },
					{ kind: 'file', path: 'finance/kpis.md' },
				],
			},
		});
		expect(parseStoredUserGroupContextAccess(stored, false)).toEqual({
			databaseAccess: stored.databaseAccess,
			docsAccess: stored.docsAccess,
		});
	});

	it('gives legacy docs all only to the default group', () => {
		const legacy = { version: 3, access: { mode: 'all', strict: true } };
		expect(parseStoredUserGroupContextAccess(legacy, true).docsAccess).toEqual(ALL_DOCS_CONTEXT_ACCESS);
		expect(parseStoredUserGroupContextAccess(legacy, false).docsAccess).toEqual(EMPTY_DOCS_CONTEXT_ACCESS);
		expect(parseStoredUserGroupContextAccess(null, true)).toEqual({
			databaseAccess: ALL_DATABASE_CONTEXT_ACCESS,
			docsAccess: ALL_DOCS_CONTEXT_ACCESS,
		});
		expect(parseStoredUserGroupContextAccess(null, false)).toEqual({
			databaseAccess: EMPTY_DATABASE_CONTEXT_ACCESS,
			docsAccess: EMPTY_DOCS_CONTEXT_ACCESS,
		});
	});

	it('fails malformed v4 sections closed independently', () => {
		expect(parseStoredUserGroupContextAccess({ version: 99 }, true)).toEqual({
			databaseAccess: EMPTY_DATABASE_CONTEXT_ACCESS,
			docsAccess: EMPTY_DOCS_CONTEXT_ACCESS,
		});
		expect(
			parseStoredUserGroupContextAccess(
				{
					version: 4,
					databaseAccess: { mode: 'all', strict: false },
					docsAccess: { mode: 'restricted', grants: [{ kind: 'file', path: '../secret' }] },
				},
				true,
			),
		).toEqual({
			databaseAccess: { mode: 'all', strict: false },
			docsAccess: EMPTY_DOCS_CONTEXT_ACCESS,
		});
		expect(
			parseStoredUserGroupContextAccess(
				{
					version: 4,
					databaseAccess: { mode: 'all', strict: 'yes' },
					docsAccess: { mode: 'all' },
				},
				false,
			),
		).toEqual({
			databaseAccess: EMPTY_DATABASE_CONTEXT_ACCESS,
			docsAccess: ALL_DOCS_CONTEXT_ACCESS,
		});
	});

	it('normalizes, deduplicates, and sorts grants without removing redundant grants', () => {
		expect(
			normalizeDocsContextAccess({
				mode: 'restricted',
				grants: [
					{ kind: 'file', path: 'z.md' },
					{ kind: 'file', path: 'finance/kpis.md' },
					{ kind: 'folder', path: 'finance' },
					{ kind: 'file', path: 'finance/kpis.md' },
				],
			}),
		).toEqual({
			mode: 'restricted',
			grants: [
				{ kind: 'folder', path: 'finance' },
				{ kind: 'file', path: 'finance/kpis.md' },
				{ kind: 'file', path: 'z.md' },
			],
		});
	});

	it('rejects unsafe and non-canonical paths', () => {
		for (const unsafe of [
			'',
			'/finance',
			'docs/finance',
			'finance/',
			'finance//kpis.md',
			'finance/./kpis.md',
			'finance/../secret',
			'C:/finance',
			'\\\\server\\share',
			'finance\\kpis.md',
			'finance%2fkpis.md',
			'finance\u0000/kpis.md',
		]) {
			expect(normalizeDocsContextPath(unsafe)).toBeNull();
		}
		expect(normalizeDocsContextPath(' Finance/収益.md ')).toBe('Finance/収益.md');
		expect(parseDocsContextAccess({ mode: 'restricted', grants: [{ kind: 'file', path: '../secret' }] })).toEqual(
			EMPTY_DOCS_CONTEXT_ACCESS,
		);
	});

	it('unions grants with all dominance', () => {
		expect(
			unionDocsContextAccess([
				{ mode: 'restricted', grants: [{ kind: 'file', path: 'one.md' }] },
				{ mode: 'restricted', grants: [{ kind: 'folder', path: 'finance' }] },
			]),
		).toEqual({
			mode: 'restricted',
			grants: [
				{ kind: 'folder', path: 'finance' },
				{ kind: 'file', path: 'one.md' },
			],
		});
		expect(unionDocsContextAccess([EMPTY_DOCS_CONTEXT_ACCESS, ALL_DOCS_CONTEXT_ACCESS])).toEqual(
			ALL_DOCS_CONTEXT_ACCESS,
		);
	});

	it('authorizes exact files and folder descendants with path boundaries', () => {
		const access = {
			mode: 'restricted' as const,
			grants: [
				{ kind: 'folder' as const, path: 'finance' },
				{ kind: 'file' as const, path: 'legal/terms.md' },
			],
		};
		expect(isDocsContextFileGranted(access, 'finance/future/new.md')).toBe(true);
		expect(isDocsContextFileGranted(access, 'finance-old/leak.md')).toBe(false);
		expect(isDocsContextFileGranted(access, 'legal/terms.md')).toBe(true);
		expect(isDocsContextFileGranted(access, 'legal/other.md')).toBe(false);
		expect(mayTraverseDocsContextDirectory(access, 'legal')).toBe(true);
		expect(mayTraverseDocsContextDirectory(access, 'finance/future')).toBe(true);
		expect(mayTraverseDocsContextDirectory(access, 'private')).toBe(false);
	});
});
