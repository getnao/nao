import { type Dirent, existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs');

import {
	getDatabaseContextCatalog,
	getDatabaseObjects,
	getTableColumnsContent,
	getUserRules,
} from '../src/agents/user-rules';

const mockExistsSync = vi.mocked(existsSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockReadFileSync = vi.mocked(readFileSync);
const unrestrictedAccess = { enforced: false } as const;

function makeDirent(name: string, isDirectory = true): Dirent {
	return { name, isDirectory: () => isDirectory } as unknown as Dirent;
}

function setupDirStructure(root: string, structure: Record<string, string[]>) {
	mockReaddirSync.mockImplementation((dir) => {
		const entries = structure[dir as string] ?? [];
		return entries.map((name) => makeDirent(name)) as unknown as ReturnType<typeof readdirSync>;
	});
	mockExistsSync.mockImplementation((path) => (path as string).startsWith(root));
}

describe('getUserRules', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns undefined without a project-root RULES.md', () => {
		mockExistsSync.mockReturnValue(false);

		expect(getUserRules('/project', { enforced: true, groupNames: ['finance'] })).toBeUndefined();
		expect(mockReadFileSync).not.toHaveBeenCalled();
	});

	it('reads and renders only the project-root RULES.md for effective groups', () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(
			'Public\n{% if group("finance") %}\nFinance\n{% endif %}\n{% if group("sales") %}\nSales\n{% endif %}\n',
		);

		expect(getUserRules('/project', { enforced: true, groupNames: ['finance'] })).toBe('Public\nFinance\n');
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
	beforeEach(() => {
		vi.clearAllMocks();
	});

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

		getDatabaseObjects(root);
		getDatabaseObjects(root);

		expect(mockReaddirSync).toHaveBeenCalledTimes(4);
	});
});

describe('getDatabaseContextCatalog', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

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

		expect(getDatabaseContextCatalog(root)).toEqual({
			syncState: 'ready',
			objects: [
				{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' },
				{ databaseType: 'snowflake', database: 'Warehouse', schema: 'Raw', table: 'Events' },
			],
		});
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
	beforeEach(() => {
		vi.clearAllMocks();
	});

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
