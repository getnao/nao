import { describe, expect, expectTypeOf, it } from 'vitest';

import {
	ALL_DATABASE_CONTEXT_ACCESS,
	ALL_DOCS_CONTEXT_ACCESS,
	ALL_FILES_CONTEXT_ACCESS,
	type DatabaseContextAccess,
	EMPTY_DATABASE_CONTEXT_ACCESS,
	EMPTY_DOCS_CONTEXT_ACCESS,
	EMPTY_FILES_CONTEXT_ACCESS,
	FAIL_CLOSED_DATABASE_CONTEXT_ACCESS,
	isDatabaseContextTableGranted,
	isDocsContextFileGranted,
	isFilesContextDirectoryGranted,
	isFilesContextFileGranted,
	matchesDatabaseContextPattern,
	mayTraverseDocsContextDirectory,
	mayTraverseFilesContextDirectory,
	normalizeDatabaseContextAccess,
	normalizeDocsContextAccess,
	normalizeDocsContextPath,
	normalizeFilesContextAccess,
	normalizeFilesContextPath,
	parseDocsContextAccess,
	parseFilesContextAccess,
	parseStoredDatabaseContextAccess,
	parseStoredUserGroupContextAccess,
	serializeDatabaseContextAccess,
	serializeUserGroupContextAccess,
	type StoredLegacyDatabaseContextAccessV2,
	unionDatabaseContextAccess,
	unionDocsContextAccess,
	unionFilesContextAccess,
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

	it('preserves explicit strict mode in current stored versions', () => {
		expect(parseStoredDatabaseContextAccess({ version: 3, access: { mode: 'all', strict: true } })).toEqual({
			mode: 'all',
			strict: true,
		});
		expect(
			parseStoredUserGroupContextAccess(
				{
					version: 4,
					databaseAccess: { mode: 'all', strict: true },
					docsAccess: { mode: 'all' },
				},
				false,
			).databaseAccess,
		).toEqual({ mode: 'all', strict: true });
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
			strict: false,
			grants: [{ kind: 'schema', databaseType: 'postgres', database: 'app', schema: 'public' }],
			patterns: [],
		});
	});

	it('migrates version 2 access with strict mode disabled', () => {
		const storedAllAccess: StoredLegacyDatabaseContextAccessV2 = {
			version: 2,
			access: { mode: 'all' },
		};
		const storedRestrictedAccess: StoredLegacyDatabaseContextAccessV2 = {
			version: 2,
			access: { mode: 'restricted', grants: [], patterns: [' Sales.* '] },
		};

		const allAccess = parseStoredDatabaseContextAccess(storedAllAccess);
		const restrictedAccess = parseStoredDatabaseContextAccess(storedRestrictedAccess);

		expectTypeOf(allAccess).toEqualTypeOf<DatabaseContextAccess>();
		expectTypeOf(restrictedAccess).toEqualTypeOf<DatabaseContextAccess>();
		expect(allAccess).toEqual({ mode: 'all', strict: false });
		expect(restrictedAccess).toEqual({
			mode: 'restricted',
			strict: false,
			grants: [],
			patterns: ['sales.*'],
		});
	});

	it('fails closed for malformed documents and grants', () => {
		expect(parseStoredDatabaseContextAccess(null)).toEqual(FAIL_CLOSED_DATABASE_CONTEXT_ACCESS);
		expect(parseStoredDatabaseContextAccess({ version: 3, access: { mode: 'all' } })).toEqual(
			FAIL_CLOSED_DATABASE_CONTEXT_ACCESS,
		);
		expect(parseStoredDatabaseContextAccess({ version: 3, access: { mode: 'all', strict: 'yes' } })).toEqual(
			FAIL_CLOSED_DATABASE_CONTEXT_ACCESS,
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
		).toEqual(FAIL_CLOSED_DATABASE_CONTEXT_ACCESS);
		expect(
			parseStoredDatabaseContextAccess({
				version: 2,
				access: { mode: 'restricted', grants: [], patterns: [42] },
			}),
		).toEqual(FAIL_CLOSED_DATABASE_CONTEXT_ACCESS);
	});

	it('lets all access dominate unions while strict mode uses OR semantics', () => {
		expect(
			unionDatabaseContextAccess([
				{ mode: 'restricted', strict: true, grants: [], patterns: [] },
				{ mode: 'all', strict: false },
			]),
		).toEqual({ mode: 'all', strict: true });

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
	it('serializes v5 with independent database, docs, and files policies', () => {
		const stored = serializeUserGroupContextAccess(
			{ mode: 'all', strict: false },
			{
				mode: 'restricted',
				grants: [
					{ kind: 'file', path: ' finance/kpis.md ' },
					{ kind: 'folder', path: 'finance' },
				],
			},
			{ mode: 'restricted', grants: [{ kind: 'folder', path: ' models ' }] },
		);

		expect(stored).toEqual({
			version: 5,
			databaseAccess: { mode: 'all', strict: false },
			docsAccess: {
				mode: 'restricted',
				grants: [
					{ kind: 'folder', path: 'finance' },
					{ kind: 'file', path: 'finance/kpis.md' },
				],
			},
			filesAccess: { mode: 'restricted', grants: [{ kind: 'folder', path: 'models' }] },
		});
		expect(parseStoredUserGroupContextAccess(stored, false)).toEqual({
			databaseAccess: stored.databaseAccess,
			docsAccess: stored.docsAccess,
			filesAccess: stored.filesAccess,
		});
	});

	it('defaults project files to all for callers that only set docs', () => {
		expect(serializeUserGroupContextAccess(ALL_DATABASE_CONTEXT_ACCESS, ALL_DOCS_CONTEXT_ACCESS)).toEqual({
			version: 5,
			databaseAccess: ALL_DATABASE_CONTEXT_ACCESS,
			docsAccess: ALL_DOCS_CONTEXT_ACCESS,
			filesAccess: ALL_FILES_CONTEXT_ACCESS,
		});
	});

	it('gives legacy docs all only to the default group', () => {
		const legacy = { version: 3, access: { mode: 'all', strict: true } };
		expect(parseStoredUserGroupContextAccess(legacy, true).docsAccess).toEqual(ALL_DOCS_CONTEXT_ACCESS);
		expect(parseStoredUserGroupContextAccess(legacy, false).docsAccess).toEqual(EMPTY_DOCS_CONTEXT_ACCESS);
		expect(parseStoredUserGroupContextAccess(null, true)).toEqual({
			databaseAccess: ALL_DATABASE_CONTEXT_ACCESS,
			docsAccess: ALL_DOCS_CONTEXT_ACCESS,
			filesAccess: ALL_FILES_CONTEXT_ACCESS,
		});
		expect(parseStoredUserGroupContextAccess(null, false)).toEqual({
			databaseAccess: EMPTY_DATABASE_CONTEXT_ACCESS,
			docsAccess: EMPTY_DOCS_CONTEXT_ACCESS,
			filesAccess: ALL_FILES_CONTEXT_ACCESS,
		});
	});

	it('keeps project files unrestricted for versions that predate them', () => {
		expect(
			parseStoredUserGroupContextAccess(
				{ version: 4, databaseAccess: { mode: 'all', strict: false }, docsAccess: EMPTY_DOCS_CONTEXT_ACCESS },
				false,
			),
		).toEqual({
			databaseAccess: { mode: 'all', strict: false },
			docsAccess: EMPTY_DOCS_CONTEXT_ACCESS,
			filesAccess: ALL_FILES_CONTEXT_ACCESS,
		});
	});

	it('fails malformed v5 sections closed independently', () => {
		expect(parseStoredUserGroupContextAccess('invalid', true)).toEqual({
			databaseAccess: FAIL_CLOSED_DATABASE_CONTEXT_ACCESS,
			docsAccess: EMPTY_DOCS_CONTEXT_ACCESS,
			filesAccess: EMPTY_FILES_CONTEXT_ACCESS,
		});
		expect(parseStoredUserGroupContextAccess({ version: 99 }, true)).toEqual({
			databaseAccess: FAIL_CLOSED_DATABASE_CONTEXT_ACCESS,
			docsAccess: EMPTY_DOCS_CONTEXT_ACCESS,
			filesAccess: EMPTY_FILES_CONTEXT_ACCESS,
		});
		expect(
			parseStoredUserGroupContextAccess(
				{
					version: 5,
					databaseAccess: { mode: 'all', strict: false },
					docsAccess: { mode: 'restricted', grants: [{ kind: 'file', path: '../secret' }] },
					filesAccess: { mode: 'restricted', grants: [{ kind: 'folder', path: 'models' }] },
				},
				true,
			),
		).toEqual({
			databaseAccess: { mode: 'all', strict: false },
			docsAccess: EMPTY_DOCS_CONTEXT_ACCESS,
			filesAccess: { mode: 'restricted', grants: [{ kind: 'folder', path: 'models' }] },
		});
		expect(
			parseStoredUserGroupContextAccess(
				{
					version: 5,
					databaseAccess: { mode: 'all', strict: 'yes' },
					docsAccess: { mode: 'all' },
					filesAccess: { mode: 'restricted', grants: [{ kind: 'file', path: 'models/orders.sql' }] },
				},
				false,
			),
		).toEqual({
			databaseAccess: FAIL_CLOSED_DATABASE_CONTEXT_ACCESS,
			docsAccess: ALL_DOCS_CONTEXT_ACCESS,
			filesAccess: { mode: 'restricted', grants: [{ kind: 'file', path: 'models/orders.sql' }] },
		});
		expect(
			parseStoredUserGroupContextAccess(
				{
					version: 5,
					databaseAccess: { mode: 'all', strict: false },
					docsAccess: { mode: 'all' },
					filesAccess: { mode: 'restricted', grants: [{ kind: 'file', path: '/etc/passwd' }] },
				},
				false,
			),
		).toEqual({
			databaseAccess: { mode: 'all', strict: false },
			docsAccess: ALL_DOCS_CONTEXT_ACCESS,
			filesAccess: EMPTY_FILES_CONTEXT_ACCESS,
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
		expect(normalizeDocsContextPath('docs')).toBe('docs');
		expect(normalizeDocsContextPath('docs/finance/kpis.md')).toBe('docs/finance/kpis.md');
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
				{ kind: 'folder' as const, path: 'docs' },
				{ kind: 'file' as const, path: 'legal/terms.md' },
			],
		};
		expect(isDocsContextFileGranted(access, 'finance/future/new.md')).toBe(true);
		expect(isDocsContextFileGranted(access, 'docs/nested.md')).toBe(true);
		expect(isDocsContextFileGranted(access, 'finance-old/leak.md')).toBe(false);
		expect(isDocsContextFileGranted(access, 'legal/terms.md')).toBe(true);
		expect(isDocsContextFileGranted(access, 'legal/other.md')).toBe(false);
		expect(mayTraverseDocsContextDirectory(access, 'legal')).toBe(true);
		expect(mayTraverseDocsContextDirectory(access, 'finance/future')).toBe(true);
		expect(mayTraverseDocsContextDirectory(access, 'private')).toBe(false);
	});
});

describe('user group files context access', () => {
	it('normalizes, deduplicates, and sorts project file grants', () => {
		expect(
			normalizeFilesContextAccess({
				mode: 'restricted',
				grants: [
					{ kind: 'file', path: 'z.sql' },
					{ kind: 'folder', path: 'models' },
					{ kind: 'file', path: 'models/orders.sql' },
					{ kind: 'file', path: 'models/orders.sql' },
				],
			}),
		).toEqual({
			mode: 'restricted',
			grants: [
				{ kind: 'folder', path: 'models' },
				{ kind: 'file', path: 'models/orders.sql' },
				{ kind: 'file', path: 'z.sql' },
			],
		});
	});

	it('rejects unsafe and non-canonical project file paths', () => {
		for (const unsafe of [
			'',
			'/models',
			'models/',
			'models/./orders.sql',
			'models/../secrets.env',
			'C:/models',
			'models\\orders.sql',
		]) {
			expect(normalizeFilesContextPath(unsafe)).toBeNull();
		}
		expect(normalizeFilesContextPath(' models/Orders.sql ')).toBe('models/Orders.sql');
		expect(normalizeFilesContextPath('models')).toBe('models');
	});

	it('unions project file grants with all dominance', () => {
		expect(
			unionFilesContextAccess([
				{ mode: 'restricted', grants: [{ kind: 'file', path: 'README.md' }] },
				{ mode: 'restricted', grants: [{ kind: 'folder', path: 'models' }] },
			]),
		).toEqual({
			mode: 'restricted',
			grants: [
				{ kind: 'folder', path: 'models' },
				{ kind: 'file', path: 'README.md' },
			],
		});
		expect(unionFilesContextAccess([EMPTY_FILES_CONTEXT_ACCESS, ALL_FILES_CONTEXT_ACCESS])).toEqual(
			ALL_FILES_CONTEXT_ACCESS,
		);
	});

	it('authorizes exact files and folder descendants with path boundaries', () => {
		const access = {
			mode: 'restricted' as const,
			grants: [
				{ kind: 'folder' as const, path: 'models' },
				{ kind: 'file' as const, path: 'requirements.txt' },
			],
		};
		expect(isFilesContextFileGranted(access, 'models/marts/orders.sql')).toBe(true);
		expect(isFilesContextFileGranted(access, 'models-old/leak.sql')).toBe(false);
		expect(isFilesContextFileGranted(access, 'requirements.txt')).toBe(true);
		expect(isFilesContextFileGranted(access, 'requirements.txt.bak')).toBe(false);
		expect(isFilesContextDirectoryGranted(access, 'models')).toBe(true);
		expect(mayTraverseFilesContextDirectory(access, 'models')).toBe(true);
		expect(mayTraverseFilesContextDirectory(access, '')).toBe(true);
		expect(mayTraverseFilesContextDirectory(access, 'scripts')).toBe(false);
	});

	it('denies everything when no project file grant survives', () => {
		expect(isFilesContextFileGranted(EMPTY_FILES_CONTEXT_ACCESS, 'README.md')).toBe(false);
		expect(mayTraverseFilesContextDirectory(EMPTY_FILES_CONTEXT_ACCESS, '')).toBe(false);
		expect(parseFilesContextAccess({ mode: 'restricted', grants: [{ kind: 'file', path: '../secret' }] })).toEqual(
			EMPTY_FILES_CONTEXT_ACCESS,
		);
	});
});
