import '../src/env';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import {
	getLatestOutcomesByTest,
	getPreviousModelSummaries,
	getTestHistory,
	listRunsWithVariantTotals,
} from '../src/services/test-history.service';
import {
	DEFAULT_TEST_COMPARISON_TOLERANCES,
	type TestContextVariant,
	type TestDefinition,
	type TestRunStatus,
	type TestRunTrigger,
} from '../src/types/test-run';

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

beforeAll(async () => {
	await db.insert(s.project).values({ id: PROJECT_ID, name: 'History', type: 'local', path: '/tmp/history' });
});

beforeEach(async () => {
	await db.delete(s.testRun).execute();
});

afterAll(() => {
	db.$client.close();
});

describe('getLatestOutcomesByTest', () => {
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
				models: [{ provider: 'openai', modelId: 'gpt-4.1', runIndex: 0, passedAttempts: 1, totalAttempts: 2 }],
				isOutdated: false,
			},
			'orders.yml': {
				runId: 'run-1',
				runCreatedAt: PREVIOUS_RUN_AT,
				passedAttempts: 1,
				totalAttempts: 1,
				models: [{ provider: 'openai', modelId: 'gpt-4.1', runIndex: 0, passedAttempts: 1, totalAttempts: 1 }],
				isOutdated: false,
			},
		});
	});

	it('ignores draft runs, which ran content that is not in the context', async () => {
		await insertRun('run-1', PREVIOUS_RUN_AT, 'completed', [['revenue.yml', 'hash-revenue', true]]);
		await insertRun('run-2', LATEST_RUN_AT, 'completed', [['revenue.yml', 'draft-hash', false]], 'draft');

		const outcomes = await getLatestOutcomesByTest(PROJECT_ID, [testDefinition('revenue.yml', 'hash-revenue')]);

		expect(outcomes['revenue.yml']).toMatchObject({ runId: 'run-1', passedAttempts: 1, isOutdated: false });
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

describe('getLatestOutcomesByTest with several models', () => {
	it("splits the outcome of the latest run by model, in the order of the run's models", async () => {
		await insertModelRun('run-1', LATEST_RUN_AT, [
			['revenue.yml', 'claude-sonnet-4-5', true],
			['revenue.yml', 'claude-haiku-4-5', false],
			['revenue.yml', 'claude-sonnet-4-5', true],
		]);

		const outcomes = await getLatestOutcomesByTest(PROJECT_ID, [testDefinition('revenue.yml', 'hash')]);

		expect(outcomes['revenue.yml']).toMatchObject({
			passedAttempts: 2,
			totalAttempts: 3,
			models: [
				{
					provider: 'anthropic',
					modelId: 'claude-sonnet-4-5',
					runIndex: 0,
					passedAttempts: 2,
					totalAttempts: 2,
				},
				{
					provider: 'anthropic',
					modelId: 'claude-haiku-4-5',
					runIndex: 1,
					passedAttempts: 0,
					totalAttempts: 1,
				},
			],
		});
	});
});

describe('listRunsWithVariantTotals', () => {
	it('adds the totals of each model to the runs that tried several', async () => {
		await insertRun('run-1', PREVIOUS_RUN_AT, 'completed', [['revenue.yml', 'hash', true]]);
		await insertModelRun('run-2', LATEST_RUN_AT, [
			['revenue.yml', 'claude-haiku-4-5', false],
			['revenue.yml', 'claude-sonnet-4-5', true],
		]);

		const runs = await listRunsWithVariantTotals(PROJECT_ID);

		expect(runs.map((run) => [run.id, run.modelTotals])).toEqual([
			[
				'run-2',
				expect.arrayContaining([
					{
						provider: 'anthropic',
						modelId: 'claude-haiku-4-5',
						contextVariant: 'production',
						passed: 0,
						total: 1,
					},
					{
						provider: 'anthropic',
						modelId: 'claude-sonnet-4-5',
						contextVariant: 'production',
						passed: 1,
						total: 1,
					},
				]),
			],
			['run-1', null],
		]);
	});
});

describe('getPreviousModelSummaries', () => {
	it('sums up each model in its previous run over the tests of the current run', async () => {
		await insertModelRun('run-1', PREVIOUS_RUN_AT, [
			['revenue.yml', 'claude-haiku-4-5', false],
			['orders.yml', 'claude-haiku-4-5', true],
			['churn.yml', 'claude-haiku-4-5', true],
		]);
		const current = await insertModelRun('run-2', LATEST_RUN_AT, [
			['revenue.yml', 'claude-haiku-4-5', true],
			['orders.yml', 'claude-haiku-4-5', true],
		]);

		const previous = await getPreviousModelSummaries(current.run, current.results);

		expect(previous).toEqual([
			{
				runId: 'run-1',
				runCreatedAt: PREVIOUS_RUN_AT,
				summary: expect.objectContaining({ modelId: 'claude-haiku-4-5', attempts: 2, passedAttempts: 1 }),
			},
		]);
	});

	it('skips earlier runs that did not try the model on all the same tests', async () => {
		await insertModelRun('run-1', PREVIOUS_RUN_AT, [['revenue.yml', 'claude-haiku-4-5', true]]);
		await insertModelRun('run-2', new Date('2026-10-25T12:00:00Z'), [['revenue.yml', 'claude-sonnet-4-5', true]]);
		const current = await insertModelRun('run-3', LATEST_RUN_AT, [
			['revenue.yml', 'claude-haiku-4-5', true],
			['orders.yml', 'claude-haiku-4-5', true],
		]);

		expect(await getPreviousModelSummaries(current.run, current.results)).toEqual([]);
	});

	it('compares nothing for a run that is still active', async () => {
		await insertModelRun('run-1', PREVIOUS_RUN_AT, [['revenue.yml', 'claude-haiku-4-5', true]]);
		const current = await insertModelRun(
			'run-2',
			LATEST_RUN_AT,
			[['revenue.yml', 'claude-haiku-4-5', true]],
			'running',
		);

		expect(await getPreviousModelSummaries(current.run, current.results)).toEqual([]);
	});
});

describe('getTestHistory', () => {
	it('lists the runs that included the test, newest first, with only its results', async () => {
		await insertRun('run-1', PREVIOUS_RUN_AT, 'completed', [
			['revenue.yml', 'hash-revenue', true],
			['orders.yml', 'hash-orders', false],
		]);
		await insertRun('run-2', LATEST_RUN_AT, 'completed', [['orders.yml', 'hash-orders', true]]);
		await insertRun('run-3', ACTIVE_RUN_AT, 'running', [], 'draft', ['revenue.yml']);

		const history = await getTestHistory(PROJECT_ID, 'revenue.yml', DEFAULT_TEST_COMPARISON_TOLERANCES);

		expect(history.map((run) => [run.id, run.results.map((result) => result.testPath)])).toEqual([
			['run-3', []],
			['run-1', ['revenue.yml']],
		]);
		expect(history.every((run) => run.comparison === null)).toBe(true);
	});

	it('compares the two variants of a comparison run', async () => {
		await insertRun(
			'run-1',
			LATEST_RUN_AT,
			'completed',
			[
				['revenue.yml', 'hash-revenue', true, 'production'],
				['revenue.yml', 'hash-revenue', false, 'draft'],
			],
			'comparison',
		);

		const [run] = await getTestHistory(PROJECT_ID, 'revenue.yml', DEFAULT_TEST_COMPARISON_TOLERANCES);

		expect(run.comparison).toMatchObject({
			change: 'regressed',
			production: { passed: 1, total: 1 },
			draft: { passed: 0, total: 1 },
		});
	});

	it('diffs the stored rows of each result', async () => {
		await insertRun('run-1', LATEST_RUN_AT, 'completed', [['revenue.yml', 'hash-revenue', false]]);
		await db
			.update(s.testRunResult)
			.set({
				details: {
					responseText: null,
					actualData: [{ month: 'jan', total: 90 }],
					expectedData: [{ month: 'jan', total: 100 }],
					comparison: null,
					referenceSql: null,
					verificationSql: null,
				},
			})
			.execute();

		const [run] = await getTestHistory(PROJECT_ID, 'revenue.yml', DEFAULT_TEST_COMPARISON_TOLERANCES);

		expect(run.results[0].dataDiff).toMatchObject({
			columns: ['month', 'total'],
			rows: [{ expected: ['jan', 100], actual: ['jan', 90], statuses: ['match', 'differ'] }],
		});
	});
});

async function insertRun(
	id: string,
	createdAt: Date,
	status: TestRunStatus,
	results: [testPath: string, testHash: string, passed: boolean, contextVariant?: TestContextVariant][],
	trigger: TestRunTrigger = 'manual',
	selection = [...new Set(results.map(([testPath]) => testPath))],
) {
	await db.insert(s.testRun).values({
		id,
		projectId: PROJECT_ID,
		status,
		trigger,
		createdAt,
		models: [{ provider: 'openai', modelId: 'gpt-4.1' }],
		selection,
		totalAttempts: results.length,
	});
	if (results.length === 0) {
		return;
	}
	await db.insert(s.testRunResult).values(
		results.map(([testPath, testHash, passed, contextVariant = 'production'], index) => ({
			runId: id,
			testPath,
			testName: testPath,
			testHash,
			llmProvider: 'openai',
			llmModelId: 'gpt-4.1',
			contextVariant,
			attempt: index + 1,
			passed,
			message: passed ? 'match' : 'values differ',
		})),
	);
}

/** Inserts a manual run whose attempts each name the Anthropic model that made them. */
async function insertModelRun(
	id: string,
	createdAt: Date,
	results: [testPath: string, modelId: string, passed: boolean][],
	status: TestRunStatus = 'completed',
) {
	const modelIds = [...new Set(results.map(([, modelId]) => modelId))];
	const [run] = await db
		.insert(s.testRun)
		.values({
			id,
			projectId: PROJECT_ID,
			status,
			trigger: 'manual',
			createdAt,
			models: modelIds.map((modelId) => ({ provider: 'anthropic' as const, modelId })),
			selection: [...new Set(results.map(([testPath]) => testPath))],
			totalAttempts: results.length,
		})
		.returning();
	const inserted = await db
		.insert(s.testRunResult)
		.values(
			results.map(([testPath, modelId, passed], index) => ({
				runId: id,
				testPath,
				testName: testPath,
				testHash: 'hash',
				llmProvider: 'anthropic' as const,
				llmModelId: modelId,
				attempt: index + 1,
				passed,
				message: passed ? 'match' : 'values differ',
			})),
		)
		.returning();
	return { run, results: inserted };
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
