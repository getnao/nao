import fs from 'node:fs/promises';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Query results come from the run's in-memory cache here; the chat history behind it needs a database.
vi.mock('../../src/queries/chat.queries', () => ({
	getQueryResultByQueryId: vi.fn(async () => null),
}));

import type { executeSql } from '@nao/shared/tools';

import { __reloadEnvForTesting } from '../../src/env';
import type { LocalQueryOutcome } from '../../src/services/local-query.service';
import { runQueryOnLocalFiles } from '../../src/services/local-query.service';
import { statUserFile, writeUserFile } from '../../src/services/storage/user-files';
import type { QueryResult, ToolContext } from '../../src/types/tools';
import { otherUserScope, userScope, useTemporaryLocalStorage } from '../helpers/storage-backend';
import { useTemporaryFolders } from '../helpers/temporary-folders';

const PERMISSION_DENIED = /file system operations are disabled|Permission Error/;
const CUSTOMERS_PREVIEW = 'databases/type=postgres/database=analytics/schema=public/table=customers/preview.md';

const getStorageRoot = useTemporaryLocalStorage();
const createTemporaryFolder = useTemporaryFolders();

let projectFolder: string;
let outsideDir: string;

beforeEach(async () => {
	projectFolder = createTemporaryFolder('nao-local-query-project-');
	outsideDir = createTemporaryFolder('nao-local-query-secret-');
	await fs.writeFile(path.join(outsideDir, 'secrets.csv'), 'token\nsk-live-42\n');
});

describe('querying saved files', () => {
	it('reads a CSV addressed by its /home path', async () => {
		await writeUserFile(userScope, 'uploads/sales.csv', 'region,amount\nEU,10\nUS,32\n');

		const result = await run("SELECT region, amount FROM read_csv('/home/uploads/sales.csv') ORDER BY region");

		expect(result.columns).toEqual(['region', 'amount']);
		expect(result.data).toEqual([
			{ region: 'EU', amount: 10 },
			{ region: 'US', amount: 32 },
		]);
	});

	it('translates each user to their own space, so the same path means different files', async () => {
		await writeUserFile(userScope, 'notes.csv', 'owner\nuser-1\n');
		await writeUserFile(otherUserScope, 'notes.csv', 'owner\nuser-2\n');

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
		const targetsFile = await writeProjectFile('targets.csv', 'region,target\nEU,100\n');

		const result = await run(`SELECT target FROM read_csv('${targetsFile}')`);

		expect(result.data).toEqual([{ target: 100 }]);
	});

	it('reads an allowed project file from a computed path', async () => {
		await writeProjectFile('targets.csv', 'region,target\nEU,100\n');

		const result = await run(`SELECT target FROM read_csv(concat('${projectFolder}/', 'targets.csv'))`);

		expect(result.data).toEqual([{ target: 100 }]);
	});
});

describe('project file discovery', () => {
	it('does not touch the project tree for non-file and storage-only queries', async () => {
		const invalidProjectFolder = `${projectFolder}\0invalid`;
		await writeUserFile(userScope, 'only-storage.csv', 'value\n7\n');

		expect((await run('SELECT 1 AS value', { projectFolder: invalidProjectFolder })).data).toEqual([{ value: 1 }]);
		expect(
			(await run("SELECT value FROM read_csv('/home/only-storage.csv')", { projectFolder: invalidProjectFolder }))
				.data,
		).toEqual([{ value: 7 }]);
	});

	it('treats a missing project root as an empty allowlist', async () => {
		const missingProjectFolder = path.join(projectFolder, 'missing');

		await expect(
			run(`SELECT * FROM read_csv(concat('${missingProjectFolder}/', 'missing.csv'))`, {
				projectFolder: missingProjectFolder,
			}),
		).rejects.toThrow(PERMISSION_DENIED);
	});

	it('skips an unreadable subtree while collecting allowed files', async () => {
		await writeProjectFile('readable.csv', 'value\n9\n');
		const unreadableDirectory = path.dirname(await writeProjectFile('unreadable/private.csv', 'value\n10\n'));
		await fs.chmod(unreadableDirectory, 0);

		try {
			await expect(fs.readdir(unreadableDirectory)).rejects.toThrow();
			const result = await run(`SELECT value FROM read_csv(concat('${projectFolder}/', 'readable.csv'))`);
			expect(result.data).toEqual([{ value: 9 }]);
		} finally {
			await fs.chmod(unreadableDirectory, 0o700);
		}
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
		await writeUserFile(userScope, 'budget.csv', 'region,budget\nEU,100\nUS,200\n');

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
			PERMISSION_DENIED,
		);
	});

	it('refuses the files of another user, even by their real path', async () => {
		await writeUserFile(otherUserScope, 'private.csv', 'secret\nnope\n');
		const theirFile = path.join(getStorageRoot(), 'projects/proj-1/users/user-2/private.csv');

		await expect(run(`SELECT * FROM read_csv('${theirFile}')`)).rejects.toThrow(PERMISSION_DENIED);
	});

	it('refuses to escape the user space by traversal', async () => {
		await writeUserFile(userScope, 'uploads/sales.csv', 'region\nEU\n');

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
		await writeUserFile(userScope, 'sales.csv', 'region\nEU\n');

		await expect(
			run(`COPY (SELECT * FROM read_csv('/home/sales.csv')) TO '${path.join(outsideDir, 'leak.csv')}'`),
		).rejects.toThrow('Only read-only queries can run against the local database');
	});

	it('refuses to attach another database', async () => {
		await expect(run(`ATTACH '${path.join(outsideDir, 'other.duckdb')}'`)).rejects.toThrow();
	});
});

describe('project context permissions', () => {
	it('refuses denied docs and database previews', async () => {
		const deniedDoc = await writeProjectFile('docs/private.md', 'private plans');
		const deniedPreview = await writeProjectFile(CUSTOMERS_PREVIEW, 'private customer row');

		await expect(run(`SELECT content FROM read_text('${deniedDoc}')`, denyAllContext())).rejects.toThrow(
			PERMISSION_DENIED,
		);
		await expect(run(`SELECT content FROM read_text('${deniedPreview}')`, denyAllContext())).rejects.toThrow(
			PERMISSION_DENIED,
		);
	});

	it('enforces partial docs, warehouse, and project file grants while keeping granted files readable', async () => {
		const grantedDoc = await writeProjectFile('docs/finance/targets.csv', 'target\n100\n');
		const grantedPreview = await writeProjectFile(
			'databases/type=postgres/database=analytics/schema=public/table=orders/preview.md',
			'allowed order row',
		);
		const deniedDoc = await writeProjectFile('docs/private/plans.md', 'private plans');
		const deniedPreview = await writeProjectFile(CUSTOMERS_PREVIEW, 'private customer row');
		const ordinaryFile = await writeProjectFile('notes.txt', 'visible');
		const deniedProjectFile = await writeProjectFile('seeds/salaries.csv', 'name,salary\n');

		const access = {
			...denyAllContext(),
			warehouseTableAccess: {
				enforced: true as const,
				strict: true,
				tables: [
					{
						databaseType: 'postgres',
						database: 'analytics',
						schema: 'public',
						table: 'orders',
					},
				],
			},
			docsContextAccess: {
				enforced: true as const,
				access: {
					mode: 'restricted' as const,
					grants: [{ kind: 'folder' as const, path: 'finance' }],
				},
			},
			filesContextAccess: {
				enforced: true as const,
				access: {
					mode: 'restricted' as const,
					grants: [{ kind: 'file' as const, path: 'notes.txt' }],
				},
			},
		};

		expect((await run(`SELECT target FROM read_csv('${grantedDoc}')`, access)).data).toEqual([{ target: 100 }]);
		expect((await run(`SELECT content FROM read_text('${grantedPreview}')`, access)).data).toEqual([
			{ content: 'allowed order row' },
		]);
		expect((await run(`SELECT content FROM read_text('${ordinaryFile}')`, access)).data).toEqual([
			{ content: 'visible' },
		]);
		await expect(run(`SELECT content FROM read_text('${deniedDoc}')`, access)).rejects.toThrow(PERMISSION_DENIED);
		await expect(run(`SELECT content FROM read_text('${deniedPreview}')`, access)).rejects.toThrow(
			PERMISSION_DENIED,
		);
		await expect(run(`SELECT name FROM read_csv('${deniedProjectFile}')`, access)).rejects.toThrow(
			PERMISSION_DENIED,
		);
	});

	it('does not let globs or computed paths recover denied files', async () => {
		const deniedDirectory = path.dirname(await writeProjectFile('docs/private/plans.md', 'private plans'));

		await expect(run(`SELECT content FROM read_text('${deniedDirectory}/*.md')`, denyAllContext())).rejects.toThrow(
			PERMISSION_DENIED,
		);
		await expect(
			run(`SELECT content FROM read_text(concat('${deniedDirectory}/', 'plans.md'))`, denyAllContext()),
		).rejects.toThrow(PERMISSION_DENIED);
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
		expect(await statUserFile(userScope, 'exports/revenue.csv')).not.toBeNull();
	});

	it('writes a Parquet the next query can read straight back', async () => {
		await runOutcome('SELECT 1 AS id, 2.5 AS ratio', {
			saveTo: { path: '/home/scratch/step-one.parquet', format: 'parquet' },
		});

		const result = await run("SELECT id, ratio FROM read_parquet('/home/scratch/step-one.parquet')");

		expect(result.data).toEqual([{ id: 1, ratio: 2.5 }]);
	});

	it('saves the rows a query over a file produced', async () => {
		await writeUserFile(userScope, 'sales.csv', 'region,amount\nEU,10\nEU,5\nUS,32\n');

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
		await writeUserFile(userScope, 'budget.csv', 'region,budget\nEU,100\n');

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

		expect(await statUserFile(userScope, 'exports/never.csv')).toBeNull();
	});

	it('refuses a result above the storage size limit', async () => {
		process.env.NAO_STORAGE_MAX_FILE_SIZE_MB = '0.0001';
		__reloadEnvForTesting();

		await expect(
			runOutcome('SELECT * FROM range(50000) t(n)', {
				saveTo: { path: '/home/exports/big.csv', format: 'csv' },
			}),
		).rejects.toThrow('File too large');

		expect(await statUserFile(userScope, 'exports/big.csv')).toBeNull();
	});
});

const run = async (sql: string, overrides: RunOverrides = {}): Promise<QueryResult> => {
	return (await runOutcome(sql, overrides)).result;
};

const runOutcome = async (sql: string, overrides: RunOverrides = {}): Promise<LocalQueryOutcome> => {
	const context = {
		projectId: userScope.projectId,
		userId: overrides.userId ?? userScope.userId,
		projectFolder: overrides.projectFolder ?? projectFolder,
		chatId: 'chat-1',
		queryResults: new Map(overrides.queryResults ?? []),
		warehouseTableAccess: overrides.warehouseTableAccess ?? { enforced: false },
		docsContextAccess: overrides.docsContextAccess ?? { enforced: false },
		filesContextAccess: overrides.filesContextAccess ?? { enforced: false },
	} as unknown as ToolContext;

	return runQueryOnLocalFiles(sql, context, overrides.saveTo);
};

interface RunOverrides {
	userId?: string;
	projectFolder?: string;
	queryResults?: [string, QueryResult][];
	saveTo?: executeSql.SaveTo;
	warehouseTableAccess?: ToolContext['warehouseTableAccess'];
	docsContextAccess?: ToolContext['docsContextAccess'];
	filesContextAccess?: ToolContext['filesContextAccess'];
}

function denyAllContext(): Pick<RunOverrides, 'warehouseTableAccess' | 'docsContextAccess' | 'filesContextAccess'> {
	return {
		warehouseTableAccess: { enforced: true, strict: true, tables: [] },
		docsContextAccess: { enforced: true, access: { mode: 'restricted', grants: [] } },
		filesContextAccess: { enforced: false },
	};
}

async function writeProjectFile(relativePath: string, content: string): Promise<string> {
	const filePath = path.join(projectFolder, relativePath);
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, content);
	return filePath;
}
