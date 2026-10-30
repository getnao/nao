import { and, asc, desc, eq, inArray, lte, notInArray, or, sql } from 'drizzle-orm';

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

export async function listRuns(projectId: string, limit = DEFAULT_RUN_LIST_LIMIT): Promise<DBTestRun[]> {
	return db
		.select()
		.from(s.testRun)
		.where(eq(s.testRun.projectId, projectId))
		.orderBy(desc(s.testRun.createdAt))
		.limit(limit)
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
