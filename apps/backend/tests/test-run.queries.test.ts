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
	listResults,
	markRunRunning,
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
const SIX_HOURS_MS = 6 * 60 * 60_000;
const RUN_INPUT = {
	projectId: PROJECT_ID,
	models: [{ provider: 'openai' as const, modelId: 'gpt-4.1' }],
	totalAttempts: 1,
};

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
		expect((await listResults(run.id)).map((result) => result.attempt)).toEqual([1]);
	});

	it('fails runs queued or started too long ago, except the ones this process is executing', async () => {
		const longAgo = new Date(Date.now() - SIX_HOURS_MS - 60_000);
		const queued = (await createRunUnlessActive(RUN_INPUT))!;
		await db.update(s.testRun).set({ createdAt: longAgo }).where(eq(s.testRun.id, queued.id)).execute();

		await expect(failStaleRuns(staleInput([]))).resolves.toBe(1);
		await expect(getRunStatus(queued.id)).resolves.toBe('failed');

		const live = (await createRunUnlessActive(RUN_INPUT))!;
		await markRunRunning(live.id, 1);
		await db.update(s.testRun).set({ createdAt: longAgo }).where(eq(s.testRun.id, live.id)).execute();

		await expect(failStaleRuns(staleInput([]))).resolves.toBe(0);

		await db.update(s.testRun).set({ startedAt: longAgo }).where(eq(s.testRun.id, live.id)).execute();
		await expect(failStaleRuns(staleInput([live.id]))).resolves.toBe(0);
		await expect(failStaleRuns(staleInput([]))).resolves.toBe(1);
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

function staleInput(liveRunIds: string[]) {
	return { projectId: PROJECT_ID, staleAfterMs: SIX_HOURS_MS, errorMessage: 'interrupted', liveRunIds };
}
