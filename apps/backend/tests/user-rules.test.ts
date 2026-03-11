import { type Dirent, existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs');
vi.mock('../src/env', () => ({ env: { NAO_DEFAULT_PROJECT_PATH: undefined } }));

import { getDatabaseObjects, getTableColumnsContent } from '../src/agents/user-rules';

const mockExistsSync = vi.mocked(existsSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockReadFileSync = vi.mocked(readFileSync);

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

describe('getDatabaseObjects', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns empty array when no folder is provided and env has no default', () => {
		const result = getDatabaseObjects(undefined);
		expect(result).toEqual([]);
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

describe('getTableColumnsContent', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns undefined when the fqdn does not match any database object', () => {
		mockExistsSync.mockReturnValue(false);
		const result = getTableColumnsContent('/project-x', 'db.schema.unknown');
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

		const result = getTableColumnsContent(root, 'mydb.public.users');

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

		const result = getTableColumnsContent(root, 'mydb.public.users');

		expect(result).toBeUndefined();
	});
});
