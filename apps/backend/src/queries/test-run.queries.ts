import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';

import s, { DBTestRun, DBTestRunResult, NewTestRun, NewTestRunResult } from '../db/abstractSchema';
import { db } from '../db/db';

const ACTIVE_STATUSES: DBTestRun['status'][] = ['queued', 'running'];
const DEFAULT_RUN_LIST_LIMIT = 50;

export async function createRun(input: NewTestRun): Promise<DBTestRun> {
	const [run] = await db.insert(s.testRun).values(input).returning().execute();
	return run;
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

export async function hasActiveRun(projectId: string): Promise<boolean> {
	const [run] = await db
		.select({ id: s.testRun.id })
		.from(s.testRun)
		.where(and(eq(s.testRun.projectId, projectId), inArray(s.testRun.status, ACTIVE_STATUSES)))
		.limit(1)
		.execute();
	return !!run;
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

/** Inserts an attempt result and folds it into the run totals in one transaction. */
export async function recordResult(result: NewTestRunResult): Promise<void> {
	await db.transaction(async (t) => {
		await t.insert(s.testRunResult).values(result).execute();
		await t
			.update(s.testRun)
			.set({
				completedAttempts: sql`${s.testRun.completedAttempts} + 1`,
				passedAttempts: sql`${s.testRun.passedAttempts} + ${result.passed ? 1 : 0}`,
				totalTokens: sql`${s.testRun.totalTokens} + ${result.totalTokens ?? 0}`,
				totalCost: sql`coalesce(${s.testRun.totalCost}, 0) + ${result.totalCost ?? 0}`,
			})
			.where(eq(s.testRun.id, result.runId))
			.execute();
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

/** Fails runs left active by a server restart, which would otherwise block new runs forever. */
export async function failStaleRuns(projectId: string, staleAfterMs: number, errorMessage: string): Promise<number> {
	const cutoff = new Date(Date.now() - staleAfterMs);
	const rows = await db
		.update(s.testRun)
		.set({ status: 'failed', completedAt: new Date(), errorMessage })
		.where(
			and(
				eq(s.testRun.projectId, projectId),
				inArray(s.testRun.status, ACTIVE_STATUSES),
				lte(s.testRun.createdAt, cutoff),
			),
		)
		.returning({ id: s.testRun.id })
		.execute();
	return rows.length;
}
