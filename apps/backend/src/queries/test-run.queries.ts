import type { LlmSelectedModel } from '@nao/shared/types';
import { and, asc, desc, eq, gte, inArray, lt, lte, max, or, type SQL, sql } from 'drizzle-orm';

import s, { DBTestRun, DBTestRunResult, NewTestRun, NewTestRunResult } from '../db/abstractSchema';
import { db, type DBTransaction } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';

const ACTIVE_STATUSES: DBTestRun['status'][] = ['queued', 'running'];

type TestRunWithAuthor = DBTestRun & { triggeredByName: string | null };
const DEFAULT_RUN_LIST_LIMIT = 50;

/** Returns null when the project already has an active run, which a partial unique index enforces. */
export async function createRunUnlessActive(input: NewTestRun): Promise<DBTestRun | null> {
	const [run] = await db
		.insert(s.testRun)
		.values({ ...input, heartbeatAt: new Date() })
		.onConflictDoNothing()
		.returning()
		.execute();
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

export async function listRuns(projectId: string, limit = DEFAULT_RUN_LIST_LIMIT): Promise<TestRunWithAuthor[]> {
	return selectRunsWithAuthor(eq(s.testRun.projectId, projectId), limit);
}

/**
 * Attempt counts of each test in the latest completed run that included it, one row per test, run, file hash
 * and model. Active, failed and cancelled runs are left out because their results are partial, and
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
			runModels: s.testRun.models,
			testHash: s.testRunResult.testHash,
			llmProvider: s.testRunResult.llmProvider,
			llmModelId: s.testRunResult.llmModelId,
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
		.groupBy(
			s.testRunResult.testPath,
			s.testRun.id,
			s.testRun.createdAt,
			s.testRun.models,
			s.testRunResult.testHash,
			s.testRunResult.llmProvider,
			s.testRunResult.llmModelId,
		)
		.orderBy(asc(s.testRunResult.llmModelId))
		.execute();
}

export async function listTestAttemptTotals(runIds: string[]) {
	if (runIds.length === 0) {
		return [];
	}
	return db
		.select({
			runId: s.testRunResult.runId,
			testPath: s.testRunResult.testPath,
			contextVariant: s.testRunResult.contextVariant,
			provider: s.testRunResult.llmProvider,
			modelId: s.testRunResult.llmModelId,
			totalAttempts: sql<number>`count(*)`.mapWith(Number),
			passedAttempts: sql<number>`sum(case when ${s.testRunResult.passed} then 1 else 0 end)`.mapWith(Number),
		})
		.from(s.testRunResult)
		.where(inArray(s.testRunResult.runId, runIds))
		.groupBy(
			s.testRunResult.runId,
			s.testRunResult.testPath,
			s.testRunResult.contextVariant,
			s.testRunResult.llmProvider,
			s.testRunResult.llmModelId,
		)
		.execute();
}

export async function listRecentModelStats(projectId: string, since: Date) {
	return db
		.select({
			provider: s.testRunResult.llmProvider,
			modelId: s.testRunResult.llmModelId,
			attempts: sql<number>`count(*)`.mapWith(Number),
			averageCost: sql<number | null>`avg(${s.testRunResult.totalCost})`.mapWith(Number),
			averageDurationMs: sql<number | null>`avg(${s.testRunResult.durationMs})`.mapWith(Number),
		})
		.from(s.testRunResult)
		.innerJoin(s.testRun, eq(s.testRun.id, s.testRunResult.runId))
		.where(and(eq(s.testRun.projectId, projectId), gte(s.testRunResult.createdAt, since)))
		.groupBy(s.testRunResult.llmProvider, s.testRunResult.llmModelId)
		.execute();
}

/** The results of a run without their stored details, which only the view of a single attempt shows. */
export async function listResultOutcomes(runId: string) {
	return db
		.select({
			id: s.testRunResult.id,
			testPath: s.testRunResult.testPath,
			testName: s.testRunResult.testName,
			llmProvider: s.testRunResult.llmProvider,
			llmModelId: s.testRunResult.llmModelId,
			contextVariant: s.testRunResult.contextVariant,
			passed: s.testRunResult.passed,
			message: s.testRunResult.message,
			errorMessage: s.testRunResult.errorMessage,
			totalTokens: s.testRunResult.totalTokens,
			totalCost: s.testRunResult.totalCost,
			durationMs: s.testRunResult.durationMs,
			toolCallCount: s.testRunResult.toolCallCount,
		})
		.from(s.testRunResult)
		.where(eq(s.testRunResult.runId, runId))
		.orderBy(
			asc(s.testRunResult.testPath),
			asc(s.testRunResult.llmModelId),
			asc(s.testRunResult.attempt),
			desc(s.testRunResult.contextVariant),
		)
		.execute();
}

/** The project's latest runs that selected a test, newest first, including those that recorded no result of it yet. */
export async function listRunsOfTest(projectId: string, testPath: string, limit: number): Promise<TestRunWithAuthor[]> {
	return selectRunsWithAuthor(and(eq(s.testRun.projectId, projectId), selectionIncludes(testPath)), limit);
}

/**
 * The production attempts of some models on some tests, in the latest completed runs of the test suite created before
 * a date, newest run first.
 */
export async function listEarlierModelAttempts(input: {
	projectId: string;
	createdBefore: Date;
	testPaths: string[];
	models: LlmSelectedModel[];
	scannedRuns: number;
}) {
	if (input.testPaths.length === 0 || input.models.length === 0) {
		return [];
	}
	const earlierRuns = db
		.select({ id: s.testRun.id })
		.from(s.testRun)
		.where(
			and(
				eq(s.testRun.projectId, input.projectId),
				eq(s.testRun.status, 'completed'),
				eq(s.testRun.trigger, 'manual'),
				lt(s.testRun.createdAt, input.createdBefore),
			),
		)
		.orderBy(desc(s.testRun.createdAt))
		.limit(input.scannedRuns);
	return db
		.select({
			runId: s.testRunResult.runId,
			runCreatedAt: s.testRun.createdAt,
			testPath: s.testRunResult.testPath,
			llmProvider: s.testRunResult.llmProvider,
			llmModelId: s.testRunResult.llmModelId,
			contextVariant: s.testRunResult.contextVariant,
			passed: s.testRunResult.passed,
			totalCost: s.testRunResult.totalCost,
			totalTokens: s.testRunResult.totalTokens,
			durationMs: s.testRunResult.durationMs,
			toolCallCount: s.testRunResult.toolCallCount,
		})
		.from(s.testRunResult)
		.innerJoin(s.testRun, eq(s.testRun.id, s.testRunResult.runId))
		.where(
			and(
				inArray(s.testRunResult.runId, earlierRuns),
				eq(s.testRunResult.contextVariant, 'production'),
				inArray(s.testRunResult.testPath, input.testPaths),
				or(
					...input.models.map((model) =>
						and(
							eq(s.testRunResult.llmProvider, model.provider),
							eq(s.testRunResult.llmModelId, model.modelId),
						),
					),
				),
			),
		)
		.orderBy(desc(s.testRun.createdAt))
		.execute();
}

export async function listResultsOfTest(runIds: string[], testPath: string): Promise<DBTestRunResult[]> {
	if (runIds.length === 0) {
		return [];
	}
	return db
		.select()
		.from(s.testRunResult)
		.where(and(inArray(s.testRunResult.runId, runIds), eq(s.testRunResult.testPath, testPath)))
		.orderBy(asc(s.testRunResult.llmModelId), asc(s.testRunResult.attempt), desc(s.testRunResult.contextVariant))
		.execute();
}

export async function markRunRunning(runId: string, totalAttempts: number): Promise<boolean> {
	const rows = await db
		.update(s.testRun)
		.set({ status: 'running', startedAt: new Date(), heartbeatAt: new Date(), totalAttempts })
		.where(and(eq(s.testRun.id, runId), eq(s.testRun.status, 'queued')))
		.returning({ id: s.testRun.id })
		.execute();
	return rows.length > 0;
}

/**
 * Folds an attempt result into the run totals and stores it, unless the run stopped running meanwhile.
 *
 * The SQLite body is synchronous because Bun commits before an async body's awaited writes run, which would let the
 * totals count a result whose insert failed.
 */
export async function recordResultWhileRunning(result: NewTestRunResult): Promise<boolean> {
	if (dbConfig.dialect === Dialect.Sqlite) {
		return db.transaction((t) => {
			const updated = foldResultIntoRun(t, result).all();
			if (updated.length === 0) {
				return false;
			}
			t.insert(s.testRunResult).values(result).run();
			return true;
		});
	}
	return db.transaction(async (t) => {
		const updated = await foldResultIntoRun(t, result).execute();
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

export async function recordHeartbeat(runId: string): Promise<void> {
	await db
		.update(s.testRun)
		.set({ heartbeatAt: new Date() })
		.where(and(eq(s.testRun.id, runId), inArray(s.testRun.status, ACTIVE_STATUSES)))
		.execute();
}

/**
 * Fails the active runs of a project whose process stopped refreshing their heartbeat, such as runs left behind by a
 * restart, which would otherwise block new runs.
 */
export async function failStaleRuns(input: {
	projectId: string;
	staleAfterMs: number;
	errorMessage: string;
}): Promise<number> {
	const rows = await db
		.update(s.testRun)
		.set({ status: 'failed', completedAt: new Date(), errorMessage: input.errorMessage })
		.where(
			and(
				eq(s.testRun.projectId, input.projectId),
				inArray(s.testRun.status, ACTIVE_STATUSES),
				lte(s.testRun.heartbeatAt, new Date(Date.now() - input.staleAfterMs)),
			),
		)
		.returning({ id: s.testRun.id })
		.execute();
	return rows.length;
}

function foldResultIntoRun(t: DBTransaction, result: NewTestRunResult) {
	return t
		.update(s.testRun)
		.set({
			completedAttempts: sql`${s.testRun.completedAttempts} + 1`,
			passedAttempts: sql`${s.testRun.passedAttempts} + ${result.passed ? 1 : 0}`,
			totalTokens: sql`${s.testRun.totalTokens} + ${result.totalTokens ?? 0}`,
			totalCost: sql`coalesce(${s.testRun.totalCost}, 0) + ${result.totalCost ?? 0}`,
		})
		.where(and(eq(s.testRun.id, result.runId), eq(s.testRun.status, 'running')))
		.returning({ id: s.testRun.id });
}

function selectionIncludes(testPath: string): SQL {
	return dbConfig.dialect === Dialect.Postgres
		? sql`${s.testRun.selection} @> jsonb_build_array(${testPath}::text)`
		: sql`exists (select 1 from json_each(${s.testRun.selection}) where json_each.value = ${testPath})`;
}

async function selectRunsWithAuthor(where: SQL | undefined, limit: number): Promise<TestRunWithAuthor[]> {
	const rows = await db
		.select({ run: s.testRun, triggeredByName: s.user.name })
		.from(s.testRun)
		.leftJoin(s.user, eq(s.user.id, s.testRun.triggeredByUserId))
		.where(where)
		.orderBy(desc(s.testRun.createdAt))
		.limit(limit)
		.execute();
	return rows.map(({ run, triggeredByName }) => ({ ...run, triggeredByName }));
}
