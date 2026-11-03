import type { LlmSelectedModel } from '@nao/shared/types';

import type { DBTestRun, DBTestRunResult } from '../db/abstractSchema';
import * as executeSqlQueries from '../queries/execute-sql.queries';
import * as testRunQueries from '../queries/test-run.queries';
import type {
	PreviousTestModelSummary,
	TestComparisonTolerances,
	TestDataDiff,
	TestDefinition,
	TestModelStats,
	TestRunResultDetails,
} from '../types/test-run';
import { compareContextVariants } from '../utils/test-comparison';
import { buildTestDataDiff } from '../utils/test-data-comparison';
import { isSameModel, resultModel, summarizeModels } from '../utils/test-model-summary';
import { summarizeRunTests, type TestAttemptTotals } from '../utils/test-run-totals';

const TEST_HISTORY_RUN_LIMIT = 10;
const QUERY_ID_PATTERN = /\bquery_\w+/g;
const TEST_HISTORY_SCANNED_RUNS = 100;
const MODEL_STATS_WINDOW_MS = 30 * 24 * 60 * 60_000;

type TestRunResultWithDiff = DBTestRunResult & {
	dataDiff: TestDataDiff | null;
	/** On the attempt of a comparison with the user's changes, how its rows differ from the same attempt on production. */
	variantDiff: TestDataDiff | null;
};

interface LatestTestOutcome {
	runId: string;
	runCreatedAt: Date;
	passedAttempts: number;
	totalAttempts: number;
	/** The outcome of each model of that run, as a run can try several, in the order of the run's models. */
	models: LatestTestModelOutcome[];
	/** The test file changed after this run, so the outcome may no longer hold. */
	isOutdated: boolean;
}

interface LatestTestModelOutcome extends LlmSelectedModel {
	/** Position of the model in the run's models, which sets its color. */
	runIndex: number;
	passedAttempts: number;
	totalAttempts: number;
}

/** The outcome of each test in the latest completed run that included it. */
export async function getLatestOutcomesByTest(
	projectId: string,
	tests: TestDefinition[],
): Promise<Record<string, LatestTestOutcome>> {
	const hashByPath = new Map(tests.map((test) => [test.path, test.hash]));
	const outcomes: Record<string, LatestTestOutcome> = {};

	for (const row of await testRunQueries.listLatestCompletedOutcomes(projectId, [...hashByPath.keys()])) {
		const outcome = (outcomes[row.testPath] ??= {
			runId: row.runId,
			runCreatedAt: row.runCreatedAt,
			passedAttempts: 0,
			totalAttempts: 0,
			models: [],
			isOutdated: false,
		});
		if (outcome.runId !== row.runId) {
			continue;
		}
		outcome.totalAttempts += row.totalAttempts;
		outcome.passedAttempts += row.passedAttempts;
		addModelOutcome(outcome.models, row);
		outcome.isOutdated ||= row.testHash !== hashByPath.get(row.testPath);
	}

	for (const outcome of Object.values(outcomes)) {
		outcome.models.sort((left, right) => left.runIndex - right.runIndex);
	}
	return outcomes;
}

/** The latest runs of the project, each with how its tests did per context variant and model. */
export async function listRunsWithTestTotals(projectId: string) {
	const runs = await testRunQueries.listRuns(projectId);
	const rows = await testRunQueries.listTestAttemptTotals(runs.map((run) => run.id));
	const rowsByRun = new Map<string, TestAttemptTotals[]>();
	for (const { runId, ...row } of rows) {
		rowsByRun.set(runId, [...(rowsByRun.get(runId) ?? []), row]);
	}
	return runs.map((run) => ({ ...run, testTotals: summarizeRunTests(rowsByRun.get(run.id) ?? [], run.models) }));
}

/**
 * Each model of a completed run of the test suite, as it did in the previous completed run that tried it on all the
 * same tests, summed up over those tests only so that the two summaries compare.
 */
export async function getPreviousModelSummaries(
	run: DBTestRun,
	results: DBTestRunResult[],
): Promise<PreviousTestModelSummary[]> {
	if (run.status !== 'completed' || run.trigger !== 'manual') {
		return [];
	}
	const earlierRuns = (await testRunQueries.listRuns(run.projectId, TEST_HISTORY_SCANNED_RUNS)).filter(
		(candidate) =>
			candidate.id !== run.id &&
			candidate.status === 'completed' &&
			candidate.trigger === 'manual' &&
			candidate.createdAt < run.createdAt,
	);
	const resultsByRun = new Map<string, Promise<DBTestRunResult[]>>();
	const loadResults = (runId: string) => {
		const loaded = resultsByRun.get(runId) ?? testRunQueries.listResults(runId);
		resultsByRun.set(runId, loaded);
		return loaded;
	};

	const summaries = await Promise.all(
		run.models.map(async (model) => {
			const testPaths = new Set(resultsOfModel(results, model).map((result) => result.testPath));
			const runsWithModel = earlierRuns.filter((earlier) =>
				earlier.models.some((other) => isSameModel(model, other)),
			);
			for (const candidate of runsWithModel) {
				const candidateResults = resultsOfModel(await loadResults(candidate.id), model);
				const ranTestPaths = new Set(candidateResults.map((result) => result.testPath));
				if ([...testPaths].every((testPath) => ranTestPaths.has(testPath))) {
					const [summary] = summarizeModels(
						candidateResults.filter((result) => testPaths.has(result.testPath)),
					);
					return { runId: candidate.id, runCreatedAt: candidate.createdAt, summary };
				}
			}
			return null;
		}),
	);
	return summaries.filter((summary): summary is PreviousTestModelSummary => summary !== null);
}

/** What each model cost and took per attempt in the project's recent runs. */
export async function getModelStats(projectId: string): Promise<TestModelStats[]> {
	return testRunQueries.listRecentModelStats(projectId, new Date(Date.now() - MODEL_STATS_WINDOW_MS));
}

/** The latest runs that include a test, newest first, each with the results of that test only. */
export async function getTestHistory(projectId: string, testPath: string, tolerances: TestComparisonTolerances) {
	const runs = (await testRunQueries.listRuns(projectId, TEST_HISTORY_SCANNED_RUNS))
		.filter((run) => run.selection?.includes(testPath))
		.slice(0, TEST_HISTORY_RUN_LIMIT);
	const results = await withSourceQueries(
		await testRunQueries.listResultsOfTest(
			runs.map((run) => run.id),
			testPath,
		),
	);
	const resultsByRun = new Map<string, TestRunResultWithDiff[]>();
	for (const result of withDataDiffs(results, tolerances)) {
		resultsByRun.set(result.runId, [...(resultsByRun.get(result.runId) ?? []), result]);
	}
	return runs.map((run) => {
		const results = resultsByRun.get(run.id) ?? [];
		const attemptsPerVariant = run.models.length * run.attempts;
		return {
			...run,
			results,
			testTotals: summarizeRunTests(results.map(toAttemptTotals), run.models),
			attemptsPerVariant,
			comparison:
				run.trigger === 'comparison'
					? (compareContextVariants(results, attemptsPerVariant).tests.at(0) ?? null)
					: null,
		};
	});
}

/**
 * Fills in the agent's queries on results recorded before they were stored, from the `execute_sql` calls of their
 * chat whose results the verification SQL selects from.
 */
export async function withSourceQueries(results: DBTestRunResult[]): Promise<DBTestRunResult[]> {
	const queryIdsByChat = new Map<string, Set<string>>();
	for (const result of results) {
		const verificationSql = result.details?.verificationSql;
		if (result.chatId && verificationSql && !result.details?.sourceQueries) {
			queryIdsByChat.set(result.chatId, new Set(verificationSql.match(QUERY_ID_PATTERN)));
		}
	}
	if (queryIdsByChat.size === 0) {
		return results;
	}
	const queriesByChat = await executeSqlQueries.getLatestSqlQueriesByChats(queryIdsByChat);
	return results.map((result) => {
		const queryIds = result.chatId ? queryIdsByChat.get(result.chatId) : undefined;
		if (!queryIds || !result.details) {
			return result;
		}
		const chatQueries = queriesByChat.get(result.chatId ?? '') ?? {};
		const sourceQueries = [...queryIds].flatMap((id) =>
			chatQueries[id] ? [{ id, sql: chatQueries[id].sqlQuery }] : [],
		);
		return { ...result, details: { ...result.details, sourceQueries } };
	});
}

/**
 * Adds to each result the cell by cell diff of its stored rows with the reference ones, and on the attempts with the
 * user's changes, with the rows of the same attempt on production.
 */
export function withDataDiffs(
	results: DBTestRunResult[],
	tolerances: TestComparisonTolerances,
): TestRunResultWithDiff[] {
	return results.map((result) => ({
		...result,
		dataDiff: buildResultDataDiff(result.details, tolerances),
		variantDiff: buildVariantDataDiff(result, findProductionAttempt(results, result), tolerances),
	}));
}

function buildResultDataDiff(
	details: TestRunResultDetails | null,
	tolerances: TestComparisonTolerances,
): TestDataDiff | null {
	if (!details?.expectedData) {
		return null;
	}
	return buildTestDataDiff(
		{ actual: details.actualData, expected: details.expectedData, expectedColumns: [] },
		tolerances,
		{ actual: details.actualRowCount, expected: details.expectedRowCount },
	);
}

function findProductionAttempt(results: DBTestRunResult[], draftResult: DBTestRunResult): DBTestRunResult | undefined {
	if (draftResult.contextVariant !== 'draft') {
		return undefined;
	}
	return results.find(
		(candidate) =>
			candidate.contextVariant === 'production' &&
			candidate.runId === draftResult.runId &&
			candidate.testPath === draftResult.testPath &&
			candidate.attempt === draftResult.attempt &&
			isSameModel(resultModel(candidate), resultModel(draftResult)),
	);
}

function buildVariantDataDiff(
	draftResult: DBTestRunResult,
	productionResult: DBTestRunResult | undefined,
	tolerances: TestComparisonTolerances,
): TestDataDiff | null {
	const productionData = productionResult?.details?.actualData;
	if (!productionData || !draftResult.details?.actualData) {
		return null;
	}
	return buildTestDataDiff(
		{ actual: draftResult.details.actualData, expected: productionData, expectedColumns: [] },
		tolerances,
		{ actual: draftResult.details.actualRowCount, expected: productionResult?.details?.actualRowCount },
	);
}

function addModelOutcome(
	models: LatestTestModelOutcome[],
	row: {
		runModels: LlmSelectedModel[];
		llmProvider: LlmSelectedModel['provider'];
		llmModelId: string;
		passedAttempts: number;
		totalAttempts: number;
	},
) {
	const model = resultModel(row);
	const existing = models.find((other) => isSameModel(model, other));
	if (existing) {
		existing.passedAttempts += row.passedAttempts;
		existing.totalAttempts += row.totalAttempts;
		return;
	}
	models.push({
		...model,
		runIndex: row.runModels.findIndex((other) => isSameModel(model, other)),
		passedAttempts: row.passedAttempts,
		totalAttempts: row.totalAttempts,
	});
}

function resultsOfModel(results: DBTestRunResult[], model: LlmSelectedModel): DBTestRunResult[] {
	return results.filter(
		(result) => result.contextVariant === 'production' && isSameModel(resultModel(result), model),
	);
}

function toAttemptTotals(result: DBTestRunResult): TestAttemptTotals {
	return {
		...resultModel(result),
		testPath: result.testPath,
		contextVariant: result.contextVariant,
		passedAttempts: result.passed ? 1 : 0,
		totalAttempts: 1,
	};
}
