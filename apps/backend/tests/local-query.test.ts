import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Query results come from the run's in-memory cache here; the chat history behind it needs a database.
vi.mock('../src/queries/chat.queries', () => ({
	getQueryResultByQueryId: vi.fn(async () => null),
}));

import type { executeSql } from '@nao/shared/tools';

import { __reloadEnvForTesting } from '../src/env';
import type { LocalQueryOutcome } from '../src/services/local-query.service';
import { runQueryOnLocalFiles } from '../src/services/local-query.service';
import { __resetStorageForTesting } from '../src/services/storage';
import { statUserFile, writeUserFile } from '../src/services/storage/user-files';
import type { QueryResult, ToolContext } from '../src/types/tools';

const scope = { projectId: 'proj-1', userId: 'user-1' };

let storageRoot: string;
let projectFolder: string;
let outsideDir: string;
let scratchDir: string;
let originalEnv: typeof process.env;

beforeEach(async () => {
	originalEnv = { ...process.env };
	storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nao-local-query-storage-'));
	projectFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'nao-local-query-project-'));
	outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nao-local-query-secret-'));
	scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nao-local-query-scratch-'));

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
		[storageRoot, projectFolder, outsideDir, scratchDir].map((dir) => fs.rm(dir, { recursive: true, force: true })),
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

describe('the MCP scratch directory', () => {
	it('reads a file from the configured scratch directory by its absolute path', async () => {
		process.env.NAO_MCP_SCRATCH_DIR = scratchDir;
		__reloadEnvForTesting();
		await fs.writeFile(path.join(scratchDir, 'mcp-out.json'), JSON.stringify([{ id: 1, name: 'EU' }]));

		const result = await run(`SELECT id, name FROM read_json_auto('${path.join(scratchDir, 'mcp-out.json')}')`);

		expect(result.data).toEqual([{ id: 1, name: 'EU' }]);
	});

	it('refuses the scratch directory when it is not configured', async () => {
		await fs.writeFile(path.join(scratchDir, 'mcp-out.json'), JSON.stringify([{ id: 1 }]));

		await expect(run(`SELECT * FROM read_json_auto('${path.join(scratchDir, 'mcp-out.json')}')`)).rejects.toThrow(
			/file system operations are disabled|Permission Error/,
		);
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

	it('refuses SQL that writes a file itself, even though save_to can', async () => {
		await writeUserFile(scope, 'sales.csv', 'region\nEU\n');

		await expect(
			run(`COPY (SELECT * FROM read_csv('/home/sales.csv')) TO '${path.join(outsideDir, 'leak.csv')}'`),
		).rejects.toThrow('Only read-only queries can run against the local database');
	});

	it('refuses to attach another database', async () => {
		await expect(run(`ATTACH '${path.join(outsideDir, 'other.duckdb')}'`)).rejects.toThrow();
	});
});

describe('saving the result', () => {
	it('writes a CSV and reports where it went', async () => {
		const { result, savedFile } = await runOutcome("SELECT 'EU' AS region, 10 AS amount", {
			saveTo: { path: '/home/exports/revenue.csv', format: 'csv' },
		});

		expect(result.data).toEqual([{ region: 'EU', amount: 10 }]);
		expect(savedFile?.path).toBe('/home/exports/revenue.csv');
		expect(savedFile?.size).toBeGreaterThan(0);
		expect(await statUserFile(scope, 'exports/revenue.csv')).not.toBeNull();
	});

	it('writes a Parquet the next query can read straight back', async () => {
		await runOutcome('SELECT 1 AS id, 2.5 AS ratio', {
			saveTo: { path: '/home/scratch/step-one.parquet', format: 'parquet' },
		});

		const result = await run("SELECT id, ratio FROM read_parquet('/home/scratch/step-one.parquet')");

		expect(result.data).toEqual([{ id: 1, ratio: 2.5 }]);
	});

	it('saves the rows a query over a file produced', async () => {
		await writeUserFile(scope, 'sales.csv', 'region,amount\nEU,10\nEU,5\nUS,32\n');

		const { savedFile } = await runOutcome(
			"SELECT region, SUM(amount) AS total FROM read_csv('/home/sales.csv') GROUP BY region ORDER BY region",
			{ saveTo: { path: '/home/exports/by-region.csv', format: 'csv' } },
		);

		expect(savedFile?.path).toBe('/home/exports/by-region.csv');
		expect(await run("SELECT total FROM read_csv('/home/exports/by-region.csv') ORDER BY total")).toEqual({
			columns: ['total'],
			data: [{ total: 15 }, { total: 32 }],
		});
	});

	it('saves a query result joined to a file, CTEs and all', async () => {
		await writeUserFile(scope, 'budget.csv', 'region,budget\nEU,100\n');

		const { savedFile } = await runOutcome(
			`WITH actuals AS (SELECT * FROM query_ff00)
			 SELECT b.region, b.budget - a.actual AS variance
			 FROM read_csv('/home/budget.csv') b JOIN actuals a USING (region)`,
			{
				queryResults: [['query_ff00', { columns: ['region', 'actual'], data: [{ region: 'EU', actual: 90 }] }]],
				saveTo: { path: '/home/exports/variance.parquet', format: 'parquet' },
			},
		);

		expect(savedFile?.path).toBe('/home/exports/variance.parquet');
		expect(await run("SELECT variance FROM read_parquet('/home/exports/variance.parquet')")).toEqual({
			columns: ['variance'],
			data: [{ variance: 10 }],
		});
	});

	it('tolerates a trailing semicolon', async () => {
		const { savedFile } = await runOutcome('SELECT 1 AS n;', {
			saveTo: { path: '/home/n.csv', format: 'csv' },
		});

		expect(savedFile?.path).toBe('/home/n.csv');
	});

	it('refuses to save anywhere but the user space', async () => {
		await expect(
			runOutcome('SELECT 1 AS n', { saveTo: { path: `${outsideDir}/leak.csv`, format: 'csv' } }),
		).rejects.toThrow('results can only be kept under /home');
	});

	it('refuses to save to the storage root', async () => {
		await expect(runOutcome('SELECT 1 AS n', { saveTo: { path: '/home', format: 'csv' } })).rejects.toThrow(
			'needs the path of a file',
		);
	});

	it('refuses a name that misdescribes the format', async () => {
		await expect(
			runOutcome('SELECT 1 AS n', { saveTo: { path: '/home/result.csv', format: 'parquet' } }),
		).rejects.toThrow('A parquet result has to be saved to a .parquet file');
	});

	it('refuses to escape the user space by traversal', async () => {
		await expect(
			runOutcome('SELECT 1 AS n', { saveTo: { path: '/home/../user-2/leak.csv', format: 'csv' } }),
		).rejects.toThrow();
	});

	it('leaves nothing behind when the query fails', async () => {
		await expect(
			runOutcome('SELECT * FROM nope', { saveTo: { path: '/home/exports/never.csv', format: 'csv' } }),
		).rejects.toThrow();

		expect(await statUserFile(scope, 'exports/never.csv')).toBeNull();
	});

	it('refuses a result above the storage size limit', async () => {
		process.env.NAO_STORAGE_MAX_FILE_SIZE_MB = '0.0001';
		__reloadEnvForTesting();

		await expect(
			runOutcome('SELECT * FROM range(50000) t(n)', {
				saveTo: { path: '/home/exports/big.csv', format: 'csv' },
			}),
		).rejects.toThrow('File too large');

		expect(await statUserFile(scope, 'exports/big.csv')).toBeNull();
	});
});

const run = async (
	sql: string,
	overrides: { userId?: string; queryResults?: [string, QueryResult][] } = {},
): Promise<QueryResult> => {
	return (await runOutcome(sql, overrides)).result;
};

const runOutcome = async (
	sql: string,
	overrides: { userId?: string; queryResults?: [string, QueryResult][]; saveTo?: executeSql.SaveTo } = {},
): Promise<LocalQueryOutcome> => {
	const context = {
		projectId: scope.projectId,
		userId: overrides.userId ?? scope.userId,
		projectFolder,
		chatId: 'chat-1',
		queryResults: new Map(overrides.queryResults ?? []),
	} as unknown as ToolContext;

	return runQueryOnLocalFiles(sql, context, overrides.saveTo);
};
