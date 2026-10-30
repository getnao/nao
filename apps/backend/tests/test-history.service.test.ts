import '../src/env';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { getLatestOutcomesByTest } from '../src/services/test-history.service';
import type { TestDefinition, TestRunStatus } from '../src/types/test-run';

vi.mock('../src/db/db', async () => {
	const { default: Database } = await import('better-sqlite3');
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import('drizzle-kit/api');
	const sqliteSchema = await import('../src/db/sqlite-schema');

	const sqlite = new Database(':memory:');
	const statements = await generateSQLiteMigration(
		await generateSQLiteDrizzleJson({}),
		await generateSQLiteDrizzleJson(sqliteSchema),
	);
	for (const statement of statements) {
		sqlite.exec(statement);
	}

	sqlite.pragma('foreign_keys = ON');

	const database = drizzle(sqlite, { schema: sqliteSchema });
	return {
		db: Object.assign(database, {
			transaction: (run: (tx: typeof database) => Promise<unknown>) => run(database),
		}),
	};
});

const PROJECT_ID = 'history-project';
const LATEST_RUN_AT = new Date('2026-10-26T10:00:00Z');
const PREVIOUS_RUN_AT = new Date('2026-10-25T10:00:00Z');
const ACTIVE_RUN_AT = new Date('2026-10-27T10:00:00Z');

describe('getLatestOutcomesByTest', () => {
	beforeAll(async () => {
		await db.insert(s.project).values({ id: PROJECT_ID, name: 'History', type: 'local', path: '/tmp/history' });
	});

	beforeEach(async () => {
		await db.delete(s.testRun).execute();
	});

	afterAll(() => {
		db.$client.close();
	});

	it('counts the attempts of the latest completed run that included each test', async () => {
		await insertRun('run-1', PREVIOUS_RUN_AT, 'completed', [
			['revenue.yml', 'hash-revenue', true],
			['orders.yml', 'hash-orders', true],
		]);
		await insertRun('run-2', LATEST_RUN_AT, 'completed', [
			['revenue.yml', 'hash-revenue', true],
			['revenue.yml', 'hash-revenue', false],
		]);
		await insertRun('run-3', ACTIVE_RUN_AT, 'running', [['revenue.yml', 'hash-revenue', true]]);

		const outcomes = await getLatestOutcomesByTest(PROJECT_ID, [
			testDefinition('revenue.yml', 'hash-revenue'),
			testDefinition('orders.yml', 'hash-orders'),
		]);

		expect(outcomes).toEqual({
			'revenue.yml': {
				runId: 'run-2',
				runCreatedAt: LATEST_RUN_AT,
				passedAttempts: 1,
				totalAttempts: 2,
				isOutdated: false,
			},
			'orders.yml': {
				runId: 'run-1',
				runCreatedAt: PREVIOUS_RUN_AT,
				passedAttempts: 1,
				totalAttempts: 1,
				isOutdated: false,
			},
		});
	});

	it('flags outcomes of tests edited since, and ignores tests that no longer exist', async () => {
		await insertRun('run-1', LATEST_RUN_AT, 'completed', [
			['revenue.yml', 'old-hash', true],
			['deleted.yml', 'hash-deleted', true],
		]);

		const outcomes = await getLatestOutcomesByTest(PROJECT_ID, [testDefinition('revenue.yml', 'new-hash')]);

		expect(Object.keys(outcomes)).toEqual(['revenue.yml']);
		expect(outcomes['revenue.yml'].isOutdated).toBe(true);
	});
});

async function insertRun(
	id: string,
	createdAt: Date,
	status: TestRunStatus,
	results: [testPath: string, testHash: string, passed: boolean][],
) {
	await db
		.insert(s.testRun)
		.values({ id, projectId: PROJECT_ID, status, createdAt, models: [], totalAttempts: results.length });
	await db.insert(s.testRunResult).values(
		results.map(([testPath, testHash, passed], index) => ({
			runId: id,
			testPath,
			testName: testPath,
			testHash,
			llmProvider: 'openai',
			llmModelId: 'gpt-4.1',
			attempt: index + 1,
			passed,
			message: passed ? 'match' : 'values differ',
		})),
	);
}

function testDefinition(path: string, hash: string): TestDefinition {
	return {
		path,
		name: path,
		prompt: 'prompt',
		sql: null,
		databaseId: null,
		assertions: [],
		tags: [],
		owner: null,
		hash,
	};
}
