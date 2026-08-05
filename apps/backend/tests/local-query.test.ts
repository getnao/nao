import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Query results come from the run's in-memory cache here; the chat history behind it needs a database.
vi.mock('../src/queries/chat.queries', () => ({
	getQueryResultByQueryId: vi.fn(async () => null),
}));

import { __reloadEnvForTesting } from '../src/env';
import { runQueryOnLocalFiles } from '../src/services/local-query.service';
import { __resetStorageForTesting } from '../src/services/storage';
import { writeUserFile } from '../src/services/storage/user-files';
import type { QueryResult, ToolContext } from '../src/types/tools';

const scope = { projectId: 'proj-1', userId: 'user-1' };

let storageRoot: string;
let projectFolder: string;
let outsideDir: string;
let originalEnv: typeof process.env;

beforeEach(async () => {
	originalEnv = { ...process.env };
	storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nao-local-query-storage-'));
	projectFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'nao-local-query-project-'));
	outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nao-local-query-secret-'));

	await fs.writeFile(path.join(outsideDir, 'secrets.csv'), 'token\nsk-live-42\n');

	process.env.NAO_STORAGE_BACKEND = 'local';
	process.env.NAO_STORAGE_LOCAL_PATH = storageRoot;
	__reloadEnvForTesting();
	__resetStorageForTesting();
});

afterEach(async () => {
	process.env = originalEnv;
	__reloadEnvForTesting();
	__resetStorageForTesting();
	await Promise.all(
		[storageRoot, projectFolder, outsideDir].map((dir) => fs.rm(dir, { recursive: true, force: true })),
	);
});

describe('querying saved files', () => {
	it('reads a CSV addressed by its /home path', async () => {
		await writeUserFile(scope, 'uploads/sales.csv', 'region,amount\nEU,10\nUS,32\n');

		const result = await run("SELECT region, amount FROM read_csv('/home/uploads/sales.csv') ORDER BY region");

		expect(result.columns).toEqual(['region', 'amount']);
		expect(result.data).toEqual([
			{ region: 'EU', amount: 10 },
			{ region: 'US', amount: 32 },
		]);
	});

	it('translates each user to their own space, so the same path means different files', async () => {
		await writeUserFile(scope, 'notes.csv', 'owner\nuser-1\n');
		await writeUserFile({ ...scope, userId: 'user-2' }, 'notes.csv', 'owner\nuser-2\n');

		const asUserOne = await run("SELECT owner FROM read_csv('/home/notes.csv')");
		const asUserTwo = await run("SELECT owner FROM read_csv('/home/notes.csv')", { userId: 'user-2' });

		expect(asUserOne.data).toEqual([{ owner: 'user-1' }]);
		expect(asUserTwo.data).toEqual([{ owner: 'user-2' }]);
	});

	it('names the file when it does not exist', async () => {
		await expect(run("SELECT * FROM read_csv('/home/nope.csv')")).rejects.toThrow(
			'No such file in permanent storage: nope.csv',
		);
	});

	it('reads a file in the project folder too', async () => {
		await fs.writeFile(path.join(projectFolder, 'targets.csv'), 'region,target\nEU,100\n');

		const result = await run(`SELECT target FROM read_csv('${path.join(projectFolder, 'targets.csv')}')`);

		expect(result.data).toEqual([{ target: 100 }]);
	});
});

describe('joining files against earlier results', () => {
	it('exposes a query result as a table named after its id', async () => {
		const result = await run('SELECT SUM(amount) AS total FROM query_ab12cd34', {
			queryResults: [['query_ab12cd34', { columns: ['amount'], data: [{ amount: 3 }, { amount: 4 }] }]],
		});

		expect(result.data).toEqual([{ total: 7 }]);
	});

	it('joins a saved file to a warehouse result', async () => {
		await writeUserFile(scope, 'budget.csv', 'region,budget\nEU,100\nUS,200\n');

		const result = await run(
			`SELECT b.region, b.budget - a.actual AS variance
			 FROM read_csv('/home/budget.csv') b
			 JOIN query_ff00 a ON a.region = b.region
			 ORDER BY b.region`,
			{
				queryResults: [
					[
						'query_ff00',
						{
							columns: ['region', 'actual'],
							data: [
								{ region: 'EU', actual: 90 },
								{ region: 'US', actual: 250 },
							],
						},
					],
				],
			},
		);

		expect(result.data).toEqual([
			{ region: 'EU', variance: 10 },
			{ region: 'US', variance: -50 },
		]);
	});
});

describe('what the query cannot reach', () => {
	it('refuses a file outside the project folder and the user space', async () => {
		await expect(run(`SELECT * FROM read_csv('${path.join(outsideDir, 'secrets.csv')}')`)).rejects.toThrow(
			/file system operations are disabled|Permission Error/,
		);
	});

	it('refuses the files of another user, even by their real path', async () => {
		await writeUserFile({ ...scope, userId: 'user-2' }, 'private.csv', 'secret\nnope\n');
		const theirFile = path.join(storageRoot, 'projects/proj-1/users/user-2/private.csv');

		await expect(run(`SELECT * FROM read_csv('${theirFile}')`)).rejects.toThrow(
			/file system operations are disabled|Permission Error/,
		);
	});

	it('refuses to escape the user space by traversal', async () => {
		await writeUserFile(scope, 'uploads/sales.csv', 'region\nEU\n');

		await expect(run("SELECT * FROM read_csv('/home/../user-2/private.csv')")).rejects.toThrow();
	});

	it('refuses to fetch over the network', async () => {
		await expect(run("SELECT * FROM read_csv('https://example.com/data.csv')")).rejects.toThrow(
			/file system operations are disabled|Permission Error|external access/,
		);
	});

	it('refuses to glob the filesystem for files to read', async () => {
		await expect(run("SELECT * FROM read_csv('/*/*.csv')")).rejects.toThrow(
			/file system operations are disabled|Permission Error|No files found/,
		);
	});

	it('refuses to widen its own permissions', async () => {
		await expect(run(`SET allowed_directories = ['${outsideDir}']`)).rejects.toThrow();
		await expect(run('SET enable_external_access = true')).rejects.toThrow();
	});

	it('refuses to write, since the local database only reads', async () => {
		await writeUserFile(scope, 'sales.csv', 'region\nEU\n');

		await expect(
			run(`COPY (SELECT * FROM read_csv('/home/sales.csv')) TO '${path.join(outsideDir, 'leak.csv')}'`),
		).rejects.toThrow('Only read-only queries can run against the local database');
	});

	it('refuses to attach another database', async () => {
		await expect(run(`ATTACH '${path.join(outsideDir, 'other.duckdb')}'`)).rejects.toThrow();
	});
});

const run = async (
	sql: string,
	overrides: { userId?: string; queryResults?: [string, QueryResult][] } = {},
): Promise<QueryResult> => {
	const context = {
		projectId: scope.projectId,
		userId: overrides.userId ?? scope.userId,
		projectFolder,
		chatId: 'chat-1',
		queryResults: new Map(overrides.queryResults ?? []),
	} as unknown as ToolContext;

	return runQueryOnLocalFiles(sql, context);
};
