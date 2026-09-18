import { type Dirent, existsSync, readdirSync, readFileSync, type Stats, statSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs');

import {
	getDatabaseContextCatalog,
	getDatabaseObjects,
	getTableColumnsContent,
	getUserRules,
	resetDatabaseContextCachesForTesting,
} from '../src/agents/user-rules';

const mockExistsSync = vi.mocked(existsSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockStatSync = vi.mocked(statSync);
const unrestrictedAccess = { enforced: false } as const;

beforeEach(() => {
	vi.resetAllMocks();
	resetDatabaseContextCachesForTesting();
	mockStatSync.mockReturnValue({ ino: 1, mtimeMs: 1, ctimeMs: 1, size: 1 } as Stats);
});

afterEach(() => {
	vi.useRealTimers();
});

function makeDirent(name: string, isDirectory = true): Dirent {
	return { name, isDirectory: () => isDirectory } as unknown as Dirent;
}

function setupDirStructure(root: string, structure: Record<string, string[]>) {
	mockReaddirSync.mockImplementation((dir) => {
		const entries = structure[dir as string] ?? [];
		return entries.map((name) => makeDirent(name)) as unknown as ReturnType<typeof readdirSync>;
	});
	mockExistsSync.mockImplementation((path) => {
		const filePath = path as string;
		return filePath === join(root, 'databases') || Object.hasOwn(structure, filePath);
	});
}

describe('getUserRules', () => {
	it('returns undefined without a project-root RULES.md', () => {
		mockExistsSync.mockReturnValue(false);

		expect(getUserRules('/project', { enforced: true, groupNames: ['finance'] })).toBeUndefined();
		expect(mockReadFileSync).not.toHaveBeenCalled();
	});

	it('reads and renders only the project-root RULES.md for effective groups case-insensitively', () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(
			'Public\n{% if group("finance") %}\nFinance\n{% endif %}\n{% if group("sales") %}\nSales\n{% endif %}\n',
		);

		expect(getUserRules('/project', { enforced: true, groupNames: ['Finance'] })).toBe('Public\nFinance\n');
		expect(mockReadFileSync).toHaveBeenCalledWith(join('/project', 'RULES.md'), 'utf-8');
	});

	it('includes conditional blocks when group enforcement is unavailable', () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue('{% if group("finance") %}\nVisible\n{% endif %}\n');

		expect(getUserRules('/project')).toBe('Visible\n');
	});

	it('logs a RULES error and omits all content when rendering fails', () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue('Public\n{% if group("finance") %}\nGuarded');
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(getUserRules('/project', { enforced: true, groupNames: ['finance'] })).toBeUndefined();
		expect(consoleSpy).toHaveBeenCalledWith('Error reading RULES.md:', expect.any(Error));
		consoleSpy.mockRestore();
	});
});

describe('getDatabaseObjects', () => {
	it('returns empty array when the databases folder does not exist', () => {
		mockExistsSync.mockReturnValue(false);
		const result = getDatabaseObjects('/project-no-db');
		expect(result).toEqual([]);
	});

	it('returns parsed database objects from the directory structure', () => {
		const root = '/project-a';
		setupDirStructure(root, {
			[join(root, 'databases')]: ['type=snowflake'],
			[join(root, 'databases', 'type=snowflake')]: ['database=mydb'],
			[join(root, 'databases', 'type=snowflake', 'database=mydb')]: ['schema=public'],
			[join(root, 'databases', 'type=snowflake', 'database=mydb', 'schema=public')]: ['table=orders'],
		});

		const result = getDatabaseObjects(root);

		expect(result).toEqual([
			{
				type: 'snowflake',
				database: 'mydb',
				schema: 'public',
				table: 'orders',
				fqdn: 'mydb.public.orders',
			},
		]);
	});

	it('returns multiple objects across types, databases, schemas, and tables', () => {
		const root = '/project-b';
		setupDirStructure(root, {
			[join(root, 'databases')]: ['type=postgres', 'type=snowflake'],
			[join(root, 'databases', 'type=postgres')]: ['database=analytics'],
			[join(root, 'databases', 'type=postgres', 'database=analytics')]: ['schema=dbo'],
			[join(root, 'databases', 'type=postgres', 'database=analytics', 'schema=dbo')]: [
				'table=users',
				'table=events',
			],
			[join(root, 'databases', 'type=snowflake')]: ['database=warehouse'],
			[join(root, 'databases', 'type=snowflake', 'database=warehouse')]: ['schema=raw'],
			[join(root, 'databases', 'type=snowflake', 'database=warehouse', 'schema=raw')]: ['table=sessions'],
		});

		const result = getDatabaseObjects(root);

		expect(result).toHaveLength(3);
		expect(result).toContainEqual({
			type: 'postgres',
			database: 'analytics',
			schema: 'dbo',
			table: 'users',
			fqdn: 'analytics.dbo.users',
		});
		expect(result).toContainEqual({
			type: 'postgres',
			database: 'analytics',
			schema: 'dbo',
			table: 'events',
			fqdn: 'analytics.dbo.events',
		});
		expect(result).toContainEqual({
			type: 'snowflake',
			database: 'warehouse',
			schema: 'raw',
			table: 'sessions',
			fqdn: 'warehouse.raw.sessions',
		});
	});

	it('returns empty array and logs error when readdirSync throws', () => {
		mockExistsSync.mockReturnValue(true);
		mockReaddirSync.mockImplementation(() => {
			throw new Error('Permission denied');
		});
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = getDatabaseObjects('/project-err');

		expect(result).toEqual([]);
		expect(consoleSpy).toHaveBeenCalledWith('Error reading database objects:', expect.any(Error));
	});

	it('returns cached result on subsequent calls with the same folder', () => {
		const root = '/project-cached';
		setupDirStructure(root, {
			[join(root, 'databases')]: ['type=postgres'],
			[join(root, 'databases', 'type=postgres')]: ['database=db1'],
			[join(root, 'databases', 'type=postgres', 'database=db1')]: ['schema=s1'],
			[join(root, 'databases', 'type=postgres', 'database=db1', 'schema=s1')]: ['table=t1'],
		});

		const first = getDatabaseObjects(root);
		vi.clearAllMocks();
		const second = getDatabaseObjects(root);

		expect(second).toBe(first);
		expect(mockReaddirSync).toHaveBeenCalledTimes(2);
		expect(mockReaddirSync).toHaveBeenNthCalledWith(1, join(root, 'databases'), { withFileTypes: true });
		expect(mockReaddirSync).toHaveBeenNthCalledWith(2, join(root, 'databases', 'type=postgres'), {
			withFileTypes: true,
		});
		expect(mockStatSync).not.toHaveBeenCalled();
	});

	it('expires cached project entries', () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const root = '/project-expired';
		setupDirStructure(root, {
			[join(root, 'databases')]: ['type=postgres'],
			[join(root, 'databases', 'type=postgres')]: ['database=db1'],
			[join(root, 'databases', 'type=postgres', 'database=db1')]: ['schema=s1'],
			[join(root, 'databases', 'type=postgres', 'database=db1', 'schema=s1')]: ['table=t1'],
		});

		const first = getDatabaseObjects(root);
		vi.setSystemTime(5 * 60 * 1000);

		expect(getDatabaseObjects(root)).not.toBe(first);
	});

	it('bounds cached project entries with deterministic FIFO eviction', () => {
		const structure: Record<string, string[]> = {};
		for (let index = 0; index <= 100; index += 1) {
			const root = `/project-bounded-${index}`;
			structure[join(root, 'databases')] = ['type=postgres'];
			structure[join(root, 'databases', 'type=postgres')] = ['database=db'];
			structure[join(root, 'databases', 'type=postgres', 'database=db')] = ['schema=public'];
			structure[join(root, 'databases', 'type=postgres', 'database=db', 'schema=public')] = ['table=users'];
		}
		setupDirStructure('/project-bounded-', structure);

		const first = getDatabaseObjects('/project-bounded-0');
		for (let index = 1; index < 100; index += 1) {
			getDatabaseObjects(`/project-bounded-${index}`);
		}
		expect(getDatabaseObjects('/project-bounded-0')).toBe(first);

		getDatabaseObjects('/project-bounded-100');

		expect(getDatabaseObjects('/project-bounded-0')).not.toBe(first);
	});
});

describe('getDatabaseContextCatalog', () => {
	it('distinguishes a missing databases tree from a successful empty scan', () => {
		mockExistsSync.mockReturnValue(false);
		expect(getDatabaseContextCatalog('/project-catalog-missing')).toEqual({
			syncState: 'missing',
			objects: [],
		});

		setupDirStructure('/project-catalog-empty', {});
		expect(getDatabaseContextCatalog('/project-catalog-empty')).toEqual({
			syncState: 'ready',
			objects: [],
		});
	});

	it('returns normalized sorted object identities without paths', () => {
		const root = '/project-catalog';
		setupDirStructure(root, {
			[join(root, 'databases')]: ['type=SnowFlake', 'type=postgres'],
			[join(root, 'databases', 'type=SnowFlake')]: ['database=Warehouse'],
			[join(root, 'databases', 'type=SnowFlake', 'database=Warehouse')]: ['schema=Raw'],
			[join(root, 'databases', 'type=SnowFlake', 'database=Warehouse', 'schema=Raw')]: ['table=Events'],
			[join(root, 'databases', 'type=postgres')]: ['database=app'],
			[join(root, 'databases', 'type=postgres', 'database=app')]: ['schema=public'],
			[join(root, 'databases', 'type=postgres', 'database=app', 'schema=public')]: ['table=users'],
		});
		mockReadFileSync.mockImplementation((path) =>
			(path as string).includes('table=users')
				? '- id (INTEGER)\n- region (code) (VARCHAR)\n'
				: '- `Event ID` (BIGINT)\n',
		);

		expect(getDatabaseContextCatalog(root)).toEqual({
			syncState: 'ready',
			objects: [
				{
					databaseType: 'postgres',
					database: 'app',
					schema: 'public',
					table: 'users',
					columns: ['id', 'region (code)'],
				},
				{
					databaseType: 'snowflake',
					database: 'Warehouse',
					schema: 'Raw',
					table: 'Events',
					columns: ['Event ID'],
				},
			],
		});
	});

	it('does not re-read the catalog within the cache TTL', () => {
		const root = '/project-catalog-cached';
		setupDirStructure(root, {
			[join(root, 'databases')]: ['type=postgres'],
			[join(root, 'databases', 'type=postgres')]: ['database=app'],
			[join(root, 'databases', 'type=postgres', 'database=app')]: ['schema=public'],
			[join(root, 'databases', 'type=postgres', 'database=app', 'schema=public')]: ['table=users'],
			[join(root, '.meta', 'databases')]: ['type=postgres'],
			[join(root, '.meta', 'databases', 'type=postgres')]: ['database=app'],
		});
		mockReadFileSync.mockReturnValue('- id (INTEGER)\n');

		getDatabaseContextCatalog(root);
		vi.clearAllMocks();
		getDatabaseContextCatalog(root);

		expect(mockReaddirSync).toHaveBeenCalledTimes(4);
		expect(mockReaddirSync).toHaveBeenNthCalledWith(1, join(root, 'databases'), { withFileTypes: true });
		expect(mockReaddirSync).toHaveBeenNthCalledWith(2, join(root, 'databases', 'type=postgres'), {
			withFileTypes: true,
		});
		expect(mockReaddirSync).toHaveBeenNthCalledWith(3, join(root, '.meta', 'databases'), {
			withFileTypes: true,
		});
		expect(mockReaddirSync).toHaveBeenNthCalledWith(4, join(root, '.meta', 'databases', 'type=postgres'), {
			withFileTypes: true,
		});
		expect(mockStatSync).toHaveBeenCalledOnce();
		expect(mockStatSync).toHaveBeenCalledWith(
			join(root, '.meta', 'databases', 'type=postgres', 'database=app', 'columns.json'),
		);
		expect(mockReadFileSync).not.toHaveBeenCalled();
	});

	it('refreshes a same-root catalog when sync replaces database metadata', () => {
		const root = '/project-catalog-resynced';
		const tableDirectory = join(root, 'databases', 'type=postgres', 'database=app', 'schema=public');
		const metadataFile = join(root, '.meta', 'databases', 'type=postgres', 'database=app', 'columns.json');
		const structure = {
			[join(root, 'databases')]: ['type=postgres'],
			[join(root, 'databases', 'type=postgres')]: ['database=app'],
			[join(root, 'databases', 'type=postgres', 'database=app')]: ['schema=public'],
			[tableDirectory]: ['table=users'],
			[join(root, '.meta', 'databases')]: ['type=postgres'],
			[join(root, '.meta', 'databases', 'type=postgres')]: ['database=app'],
		};
		setupDirStructure(root, structure);
		mockStatSync.mockImplementation((path) => {
			expect(path).toBe(metadataFile);
			return { ino: 1, mtimeMs: 1, ctimeMs: 1, size: 17 } as Stats;
		});
		mockReadFileSync.mockReturnValue('- old_name (TEXT)\n');
		expect(getDatabaseContextCatalog(root).objects[0].columns).toEqual(['old_name']);

		structure[tableDirectory] = ['table=orders'];
		mockStatSync.mockReturnValue({ ino: 2, mtimeMs: 2, ctimeMs: 2, size: 18 } as Stats);
		mockReadFileSync.mockReturnValue('- new_name (TEXT)\n');

		expect(getDatabaseContextCatalog(root).objects).toEqual([
			{
				databaseType: 'postgres',
				database: 'app',
				schema: 'public',
				table: 'orders',
				columns: ['new_name'],
			},
		]);
		expect(mockReadFileSync).toHaveBeenCalledTimes(2);
	});

	it('bypasses and updates the cache for a fresh read', () => {
		const root = '/project-catalog-fresh';
		setupDirStructure(root, {
			[join(root, 'databases')]: ['type=postgres'],
			[join(root, 'databases', 'type=postgres')]: ['database=app'],
			[join(root, 'databases', 'type=postgres', 'database=app')]: ['schema=public'],
			[join(root, 'databases', 'type=postgres', 'database=app', 'schema=public')]: ['table=users'],
		});
		mockReadFileSync.mockReturnValue('- old_column (INTEGER)\n');
		expect(getDatabaseContextCatalog(root).objects[0].columns).toEqual(['old_column']);

		mockReadFileSync.mockReturnValue('- new_column (INTEGER)\n');
		expect(getDatabaseContextCatalog(root, { fresh: true }).objects[0].columns).toEqual(['new_column']);
		expect(getDatabaseContextCatalog(root).objects[0].columns).toEqual(['new_column']);

		expect(mockReaddirSync).toHaveBeenCalledTimes(14);
		expect(mockReadFileSync).toHaveBeenCalledTimes(2);
	});

	it('keys cached catalogs by project folder', () => {
		const firstRoot = '/project-catalog-keyed/first';
		const secondRoot = '/project-catalog-keyed/second';
		setupDirStructure('/project-catalog-keyed', {
			[join(firstRoot, 'databases')]: ['type=postgres'],
			[join(firstRoot, 'databases', 'type=postgres')]: ['database=first'],
			[join(firstRoot, 'databases', 'type=postgres', 'database=first')]: ['schema=public'],
			[join(firstRoot, 'databases', 'type=postgres', 'database=first', 'schema=public')]: ['table=users'],
			[join(secondRoot, 'databases')]: ['type=postgres'],
			[join(secondRoot, 'databases', 'type=postgres')]: ['database=second'],
			[join(secondRoot, 'databases', 'type=postgres', 'database=second')]: ['schema=public'],
			[join(secondRoot, 'databases', 'type=postgres', 'database=second', 'schema=public')]: ['table=users'],
		});
		mockReadFileSync.mockReturnValue('- id (INTEGER)\n');

		expect(getDatabaseContextCatalog(firstRoot).objects[0].database).toBe('first');
		expect(getDatabaseContextCatalog(secondRoot).objects[0].database).toBe('second');
		expect(getDatabaseContextCatalog(firstRoot).objects[0].database).toBe('first');

		expect(mockReaddirSync).toHaveBeenCalledTimes(14);
		expect(mockReadFileSync).toHaveBeenCalledTimes(2);
	});

	it('expires cached catalog entries', () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const root = '/project-catalog-expired';
		setupDirStructure(root, {
			[join(root, 'databases')]: ['type=postgres'],
			[join(root, 'databases', 'type=postgres')]: ['database=app'],
			[join(root, 'databases', 'type=postgres', 'database=app')]: ['schema=public'],
			[join(root, 'databases', 'type=postgres', 'database=app', 'schema=public')]: ['table=users'],
		});
		mockReadFileSync.mockReturnValue('- id (INTEGER)\n');

		const first = getDatabaseContextCatalog(root);
		vi.setSystemTime(5 * 60 * 1000);

		expect(getDatabaseContextCatalog(root)).not.toBe(first);
		expect(mockReadFileSync).toHaveBeenCalledTimes(2);
	});

	it('bounds cached catalog entries with deterministic FIFO eviction', () => {
		const structure: Record<string, string[]> = {};
		for (let index = 0; index <= 100; index += 1) {
			const root = `/project-catalog-bounded-${index}`;
			structure[join(root, 'databases')] = ['type=postgres'];
			structure[join(root, 'databases', 'type=postgres')] = ['database=db'];
			structure[join(root, 'databases', 'type=postgres', 'database=db')] = ['schema=public'];
			structure[join(root, 'databases', 'type=postgres', 'database=db', 'schema=public')] = ['table=users'];
		}
		setupDirStructure('/project-catalog-bounded-', structure);
		mockReadFileSync.mockReturnValue('- id (INTEGER)\n');

		const first = getDatabaseContextCatalog('/project-catalog-bounded-0');
		for (let index = 1; index < 100; index += 1) {
			getDatabaseContextCatalog(`/project-catalog-bounded-${index}`);
		}
		expect(getDatabaseContextCatalog('/project-catalog-bounded-0')).toBe(first);

		getDatabaseContextCatalog('/project-catalog-bounded-100');

		expect(getDatabaseContextCatalog('/project-catalog-bounded-0')).not.toBe(first);
		expect(mockReadFileSync).toHaveBeenCalledTimes(102);
	});

	it('resets same-root cached content for test isolation', () => {
		const root = '/project-catalog-isolated';
		setupDirStructure(root, {
			[join(root, 'databases')]: ['type=postgres'],
			[join(root, 'databases', 'type=postgres')]: ['database=app'],
			[join(root, 'databases', 'type=postgres', 'database=app')]: ['schema=public'],
			[join(root, 'databases', 'type=postgres', 'database=app', 'schema=public')]: ['table=users'],
		});
		mockReadFileSync.mockReturnValue('- first_name (TEXT)\n');
		expect(getDatabaseContextCatalog(root).objects[0].columns).toEqual(['first_name']);

		mockReadFileSync.mockReturnValue('- second_name (TEXT)\n');
		resetDatabaseContextCachesForTesting();

		expect(getDatabaseContextCatalog(root).objects[0].columns).toEqual(['second_name']);
	});

	it('parses quoted column names and nested type parentheses', () => {
		const root = '/project-catalog-identifiers';
		setupDirStructure(root, {
			[join(root, 'databases')]: ['type=postgres'],
			[join(root, 'databases', 'type=postgres')]: ['database=app'],
			[join(root, 'databases', 'type=postgres', 'database=app')]: ['schema=public'],
			[join(root, 'databases', 'type=postgres', 'database=app', 'schema=public')]: ['table=regions'],
		});
		mockReadFileSync.mockReturnValue(
			'- `region (code)` (VARCHAR(20))\n- "Case Sensitive" (DECIMAL(10, 2))\n- plain (TEXT)\n',
		);

		expect(getDatabaseContextCatalog(root).objects[0].columns).toEqual([
			'region (code)',
			'Case Sensitive',
			'plain',
		]);
	});

	it('ignores quoted parentheses in generated column defaults and descriptions', () => {
		const root = '/project-catalog-quoted-metadata';
		setupDirStructure(root, {
			[join(root, 'databases')]: ['type=clickhouse'],
			[join(root, 'databases', 'type=clickhouse')]: ['database=app'],
			[join(root, 'databases', 'type=clickhouse', 'database=app')]: ['schema=public'],
			[join(root, 'databases', 'type=clickhouse', 'database=app', 'schema=public')]: ['table=events'],
		});
		mockReadFileSync.mockReturnValue(
			[
				"- single_default (String, DEFAULT 'prefix (')",
				'- double_default (String, DEFAULT "suffix )")',
				'- backtick_default (String, DEFAULT `prefix (`)',
				String.raw`- escaped_quote (String, DEFAULT 'can\'t )')`,
				"- doubled_quote (String, DEFAULT 'can''t )')",
				'- described (String, "value ""with quote"" (")',
			].join('\n'),
		);

		expect(getDatabaseContextCatalog(root).objects[0].columns).toEqual([
			'single_default',
			'double_default',
			'backtick_default',
			'escaped_quote',
			'doubled_quote',
			'described',
		]);
	});

	it('parses a generated description ending in a literal backslash', () => {
		const root = '/project-catalog-trailing-backslash';
		setupDirStructure(root, {
			[join(root, 'databases')]: ['type=postgres'],
			[join(root, 'databases', 'type=postgres')]: ['database=app'],
			[join(root, 'databases', 'type=postgres', 'database=app')]: ['schema=public'],
			[join(root, 'databases', 'type=postgres', 'database=app', 'schema=public')]: ['table=files'],
		});
		mockReadFileSync.mockReturnValue(String.raw`- path (TEXT, "ends with \")`);

		expect(getDatabaseContextCatalog(root).objects[0].columns).toEqual(['path']);
	});

	it('surfaces filesystem scan failures', () => {
		mockExistsSync.mockReturnValue(true);
		mockReaddirSync.mockImplementation(() => {
			throw new Error('Permission denied');
		});

		expect(() => getDatabaseContextCatalog('/project-catalog-error')).toThrow('Permission denied');
	});
});

describe('getTableColumnsContent', () => {
	it('returns undefined when the fqdn does not match any database object', () => {
		mockExistsSync.mockReturnValue(false);
		const result = getTableColumnsContent('/project-x', 'db.schema.unknown', unrestrictedAccess);
		expect(result).toBeUndefined();
	});

	it('returns the columns file content when the fqdn matches', () => {
		const root = '/project-cols';
		setupDirStructure(root, {
			[join(root, 'databases')]: ['type=postgres'],
			[join(root, 'databases', 'type=postgres')]: ['database=mydb'],
			[join(root, 'databases', 'type=postgres', 'database=mydb')]: ['schema=public'],
			[join(root, 'databases', 'type=postgres', 'database=mydb', 'schema=public')]: ['table=users'],
		});
		mockReadFileSync.mockReturnValue('# id\n# name\n');

		const result = getTableColumnsContent(root, 'mydb.public.users', unrestrictedAccess);

		const expectedPath = join(
			root,
			'databases',
			'type=postgres',
			'database=mydb',
			'schema=public',
			'table=users',
			'columns.md',
		);
		expect(result).toBe('# id\n# name\n');
		expect(mockReadFileSync).toHaveBeenCalledWith(expectedPath, 'utf-8');
	});

	it('selects an allowed warehouse object when multiple types share an fqdn', () => {
		const root = '/project-cols-shared-fqdn';
		setupDirStructure(root, {
			[join(root, 'databases')]: ['type=postgres', 'type=snowflake'],
			[join(root, 'databases', 'type=postgres')]: ['database=mydb'],
			[join(root, 'databases', 'type=postgres', 'database=mydb')]: ['schema=public'],
			[join(root, 'databases', 'type=postgres', 'database=mydb', 'schema=public')]: ['table=users'],
			[join(root, 'databases', 'type=snowflake')]: ['database=mydb'],
			[join(root, 'databases', 'type=snowflake', 'database=mydb')]: ['schema=public'],
			[join(root, 'databases', 'type=snowflake', 'database=mydb', 'schema=public')]: ['table=users'],
		});
		mockReadFileSync.mockReturnValue('# snowflake columns\n');

		const result = getTableColumnsContent(root, 'mydb.public.users', {
			enforced: true,
			strict: true,
			tables: [{ databaseType: 'snowflake', database: 'mydb', schema: 'public', table: 'users' }],
		});

		expect(result).toBe('# snowflake columns\n');
		expect(mockReadFileSync).toHaveBeenCalledWith(
			join(root, 'databases', 'type=snowflake', 'database=mydb', 'schema=public', 'table=users', 'columns.md'),
			'utf-8',
		);
	});

	it('returns undefined when reading the columns file fails', () => {
		const root = '/project-cols-err';
		setupDirStructure(root, {
			[join(root, 'databases')]: ['type=postgres'],
			[join(root, 'databases', 'type=postgres')]: ['database=mydb'],
			[join(root, 'databases', 'type=postgres', 'database=mydb')]: ['schema=public'],
			[join(root, 'databases', 'type=postgres', 'database=mydb', 'schema=public')]: ['table=users'],
		});
		mockReadFileSync.mockImplementation(() => {
			throw new Error('File not found');
		});

		const result = getTableColumnsContent(root, 'mydb.public.users', unrestrictedAccess);

		expect(result).toBeUndefined();
	});

	it('does not read columns for a denied table', () => {
		const root = '/project-cols-denied';
		setupDirStructure(root, {
			[join(root, 'databases')]: ['type=postgres'],
			[join(root, 'databases', 'type=postgres')]: ['database=mydb'],
			[join(root, 'databases', 'type=postgres', 'database=mydb')]: ['schema=public'],
			[join(root, 'databases', 'type=postgres', 'database=mydb', 'schema=public')]: ['table=users'],
		});

		const result = getTableColumnsContent(root, 'mydb.public.users', {
			enforced: true,
			strict: false,
			tables: [],
		});

		expect(result).toBeUndefined();
		expect(mockReadFileSync).not.toHaveBeenCalled();
	});
});
