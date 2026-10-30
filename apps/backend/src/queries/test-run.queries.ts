import { and, asc, desc, eq, inArray, lte, max, notInArray, or, sql } from 'drizzle-orm';

import s, { DBTestRun, DBTestRunResult, NewTestRun, NewTestRunResult } from '../db/abstractSchema';
import { db } from '../db/db';

const ACTIVE_STATUSES: DBTestRun['status'][] = ['queued', 'running'];
const DEFAULT_RUN_LIST_LIMIT = 50;

/** Returns null when the project already has an active run, which a partial unique index enforces. */
export async function createRunUnlessActive(input: NewTestRun): Promise<DBTestRun | null> {
	const [run] = await db.insert(s.testRun).values(input).onConflictDoNothing().returning().execute();
	return run ?? null;
}

export async function getRun(projectId: string, runId: string): Promise<DBTestRun | null> {
	const [run] = await db
		.select()
		.from(s.testRun)
		.where(and(eq(s.testRun.id, runId), eq(s.testRun.projectId, projectId)))
		.limit(1)
		.execute();
	return run ?? null;
}

export async function getRunStatus(runId: string): Promise<DBTestRun['status'] | null> {
	const [run] = await db
		.select({ status: s.testRun.status })
		.from(s.testRun)
		.where(eq(s.testRun.id, runId))
		.limit(1)
		.execute();
	return run?.status ?? null;
}

export async function listRuns(
	projectId: string,
	limit = DEFAULT_RUN_LIST_LIMIT,
): Promise<(DBTestRun & { triggeredByName: string | null })[]> {
	const rows = await db
		.select({ run: s.testRun, triggeredByName: s.user.name })
		.from(s.testRun)
		.leftJoin(s.user, eq(s.user.id, s.testRun.triggeredByUserId))
		.where(eq(s.testRun.projectId, projectId))
		.orderBy(desc(s.testRun.createdAt))
		.limit(limit)
		.execute();
	return rows.map(({ run, triggeredByName }) => ({ ...run, triggeredByName }));
}

/**
 * Attempt counts of each test in the latest completed run that included it, one row per test, run and
 * file hash. Active, failed and cancelled runs are left out because their results are partial, and
 * draft runs because they ran content that is not in the context.
 */
export async function listLatestCompletedOutcomes(projectId: string, testPaths: string[]) {
	if (testPaths.length === 0) {
		return [];
	}
	const completedResults = and(
		eq(s.testRun.projectId, projectId),
		eq(s.testRun.status, 'completed'),
		eq(s.testRun.trigger, 'manual'),
		inArray(s.testRunResult.testPath, testPaths),
	);
	const latestRunByTest = db.$with('latest_run_by_test').as(
		db
			.select({
				testPath: s.testRunResult.testPath,
				runCreatedAt: max(s.testRun.createdAt).as('latest_run_created_at'),
			})
			.from(s.testRunResult)
			.innerJoin(s.testRun, eq(s.testRun.id, s.testRunResult.runId))
			.where(completedResults)
			.groupBy(s.testRunResult.testPath),
	);
	return db
		.with(latestRunByTest)
		.select({
			testPath: s.testRunResult.testPath,
			runId: s.testRun.id,
			runCreatedAt: s.testRun.createdAt,
			testHash: s.testRunResult.testHash,
			totalAttempts: sql<number>`count(*)`.mapWith(Number),
			passedAttempts: sql<number>`sum(case when ${s.testRunResult.passed} then 1 else 0 end)`.mapWith(Number),
		})
		.from(s.testRunResult)
		.innerJoin(s.testRun, eq(s.testRun.id, s.testRunResult.runId))
		.innerJoin(
			latestRunByTest,
			and(
				eq(latestRunByTest.testPath, s.testRunResult.testPath),
				eq(latestRunByTest.runCreatedAt, s.testRun.createdAt),
			),
		)
		.where(completedResults)
		.groupBy(s.testRunResult.testPath, s.testRun.id, s.testRun.createdAt, s.testRunResult.testHash)
		.execute();
}

export async function listResults(runId: string): Promise<DBTestRunResult[]> {
	return db
		.select()
		.from(s.testRunResult)
		.where(eq(s.testRunResult.runId, runId))
		.orderBy(asc(s.testRunResult.testPath), asc(s.testRunResult.llmModelId), asc(s.testRunResult.attempt))
		.execute();
}

export async function markRunRunning(runId: string, totalAttempts: number): Promise<boolean> {
	const rows = await db
		.update(s.testRun)
		.set({ status: 'running', startedAt: new Date(), totalAttempts })
		.where(and(eq(s.testRun.id, runId), eq(s.testRun.status, 'queued')))
		.returning({ id: s.testRun.id })
		.execute();
	return rows.length > 0;
}

/** Folds an attempt result into the run totals and stores it, unless the run stopped running meanwhile. */
export async function recordResultWhileRunning(result: NewTestRunResult): Promise<boolean> {
	return db.transaction(async (t) => {
		const updated = await t
			.update(s.testRun)
			.set({
				completedAttempts: sql`${s.testRun.completedAttempts} + 1`,
				passedAttempts: sql`${s.testRun.passedAttempts} + ${result.passed ? 1 : 0}`,
				totalTokens: sql`${s.testRun.totalTokens} + ${result.totalTokens ?? 0}`,
				totalCost: sql`coalesce(${s.testRun.totalCost}, 0) + ${result.totalCost ?? 0}`,
			})
			.where(and(eq(s.testRun.id, result.runId), eq(s.testRun.status, 'running')))
			.returning({ id: s.testRun.id })
			.execute();
		if (updated.length === 0) {
			return false;
		}
		await t.insert(s.testRunResult).values(result).execute();
		return true;
	});
}

export async function completeRun(runId: string): Promise<void> {
	await db
		.update(s.testRun)
		.set({ status: 'completed', completedAt: new Date() })
		.where(and(eq(s.testRun.id, runId), eq(s.testRun.status, 'running')))
		.execute();
}

export async function failRun(runId: string, errorMessage: string): Promise<void> {
	await db
		.update(s.testRun)
		.set({ status: 'failed', completedAt: new Date(), errorMessage })
		.where(and(eq(s.testRun.id, runId), inArray(s.testRun.status, ACTIVE_STATUSES)))
		.execute();
}

export async function cancelRun(runId: string): Promise<boolean> {
	const rows = await db
		.update(s.testRun)
		.set({ status: 'cancelled', completedAt: new Date() })
		.where(and(eq(s.testRun.id, runId), inArray(s.testRun.status, ACTIVE_STATUSES)))
		.returning({ id: s.testRun.id })
		.execute();
	return rows.length > 0;
}

/**
 * Fails runs left active by a server restart, which would otherwise block new runs forever.
 * Queued runs age from their creation and running ones from their start; runs this process is executing are kept.
 */
export async function failStaleRuns(input: {
	projectId: string;
	staleAfterMs: number;
	errorMessage: string;
	liveRunIds: string[];
}): Promise<number> {
	const cutoff = new Date(Date.now() - input.staleAfterMs);
	const rows = await db
		.update(s.testRun)
		.set({ status: 'failed', completedAt: new Date(), errorMessage: input.errorMessage })
		.where(
			and(
				eq(s.testRun.projectId, input.projectId),
				or(
					and(eq(s.testRun.status, 'queued'), lte(s.testRun.createdAt, cutoff)),
					and(eq(s.testRun.status, 'running'), lte(s.testRun.startedAt, cutoff)),
				),
				input.liveRunIds.length > 0 ? notInArray(s.testRun.id, input.liveRunIds) : undefined,
			),
		)
		.returning({ id: s.testRun.id })
		.execute();
	return rows.length;
}
