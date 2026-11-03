import '../src/env';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import {
	cancelRun,
	createRunUnlessActive,
	failStaleRuns,
	getRunStatus,
	listResultOutcomes,
	listRunsOfTest,
	listTestAttemptTotals,
	markRunRunning,
	recordHeartbeat,
	recordResultWhileRunning,
} from '../src/queries/test-run.queries';

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

const PROJECT_ID = 'test-run-project';
const STALE_AFTER_MS = 2 * 60_000;
const RUN_INPUT = {
	projectId: PROJECT_ID,
	models: [{ provider: 'openai' as const, modelId: 'gpt-4.1' }],
	totalAttempts: 1,
};
const STALE_INPUT = { projectId: PROJECT_ID, staleAfterMs: STALE_AFTER_MS, errorMessage: 'interrupted' };

describe('test run queries', () => {
	beforeAll(async () => {
		await db.insert(s.project).values({ id: PROJECT_ID, name: 'Tests', type: 'local', path: '/tmp/tests' });
	});

	beforeEach(async () => {
		await db.delete(s.testRun).execute();
	});

	afterAll(() => {
		db.$client.close();
	});

	it('creates at most one active run per project', async () => {
		const first = await createRunUnlessActive(RUN_INPUT);

		expect(first).not.toBeNull();
		await expect(createRunUnlessActive(RUN_INPUT)).resolves.toBeNull();

		await cancelRun(first!.id);
		await expect(createRunUnlessActive(RUN_INPUT)).resolves.not.toBeNull();
	});

	it('records results only while the run is running', async () => {
		const run = (await createRunUnlessActive(RUN_INPUT))!;
		await markRunRunning(run.id, 2);

		await expect(recordResultWhileRunning(attemptResult(run.id, 1))).resolves.toBe(true);
		await cancelRun(run.id);
		await expect(recordResultWhileRunning(attemptResult(run.id, 2))).resolves.toBe(false);

		const [stored] = await db.select().from(s.testRun).where(eq(s.testRun.id, run.id)).execute();
		expect(stored).toMatchObject({ completedAttempts: 1, passedAttempts: 1, totalTokens: 10 });
		expect(await listResultOutcomes(run.id)).toHaveLength(1);
	});

	it('fails the active runs whose process stopped refreshing their heartbeat', async () => {
		const longAgo = new Date(Date.now() - STALE_AFTER_MS - 60_000);
		const queued = (await createRunUnlessActive(RUN_INPUT))!;
		await db.update(s.testRun).set({ heartbeatAt: longAgo }).where(eq(s.testRun.id, queued.id)).execute();

		await expect(failStaleRuns(STALE_INPUT)).resolves.toBe(1);
		await expect(getRunStatus(queued.id)).resolves.toBe('failed');

		const live = (await createRunUnlessActive(RUN_INPUT))!;
		await markRunRunning(live.id, 1);
		await db
			.update(s.testRun)
			.set({ createdAt: longAgo, startedAt: longAgo })
			.where(eq(s.testRun.id, live.id))
			.execute();

		await expect(failStaleRuns(STALE_INPUT)).resolves.toBe(0);

		await db.update(s.testRun).set({ heartbeatAt: longAgo }).where(eq(s.testRun.id, live.id)).execute();
		await recordHeartbeat(live.id);
		await expect(failStaleRuns(STALE_INPUT)).resolves.toBe(0);

		await db.update(s.testRun).set({ heartbeatAt: longAgo }).where(eq(s.testRun.id, live.id)).execute();
		await expect(failStaleRuns(STALE_INPUT)).resolves.toBe(1);
	});

	it('lists the runs that selected a test, newest first, even before they recorded a result of it', async () => {
		const older = (await createRunUnlessActive({ ...RUN_INPUT, selection: ['revenue.yml', 'orders.yml'] }))!;
		await cancelRun(older.id);
		const other = (await createRunUnlessActive({ ...RUN_INPUT, selection: ['orders.yml'] }))!;
		await cancelRun(other.id);
		const newer = (await createRunUnlessActive({ ...RUN_INPUT, selection: ['revenue.yml'] }))!;
		await db
			.update(s.testRun)
			.set({ createdAt: new Date(Date.now() - 60_000) })
			.where(eq(s.testRun.id, older.id))
			.execute();

		const runs = await listRunsOfTest(PROJECT_ID, 'revenue.yml', 10);

		expect(runs.map((run) => run.id)).toEqual([newer.id, older.id]);
		expect(await listRunsOfTest(PROJECT_ID, 'revenue.yml', 1)).toHaveLength(1);
	});

	it('totals the attempts of each test of a comparison run per context variant', async () => {
		const run = (await createRunUnlessActive({ ...RUN_INPUT, trigger: 'comparison', totalAttempts: 3 }))!;
		await markRunRunning(run.id, 3);
		await recordResultWhileRunning(attemptResult(run.id, 1));
		await recordResultWhileRunning({ ...attemptResult(run.id, 1), contextVariant: 'draft' });
		await recordResultWhileRunning({ ...attemptResult(run.id, 2), contextVariant: 'draft', passed: false });

		const totals = await listTestAttemptTotals([run.id]);

		expect(totals).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					runId: run.id,
					contextVariant: 'production',
					passedAttempts: 1,
					totalAttempts: 1,
				}),
				expect.objectContaining({
					runId: run.id,
					contextVariant: 'draft',
					passedAttempts: 1,
					totalAttempts: 2,
				}),
			]),
		);
		expect((await listResultOutcomes(run.id)).map((result) => result.contextVariant)).toEqual([
			'production',
			'draft',
			'draft',
		]);
	});
});

function attemptResult(runId: string, attempt: number) {
	return {
		runId,
		testPath: 'revenue.yml',
		testName: 'revenue',
		testHash: 'hash',
		llmProvider: 'openai',
		llmModelId: 'gpt-4.1',
		attempt,
		passed: true,
		message: 'match',
		totalTokens: 10,
	};
}
