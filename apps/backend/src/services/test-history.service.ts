import type { DBTestRun, DBTestRunResult } from '../db/abstractSchema';
import * as testRunQueries from '../queries/test-run.queries';
import type { ActiveEffort } from '../types/llm';
import type {
	PreviousTestModelSummary,
	TestComparisonTolerances,
	TestDataDiff,
	TestDefinition,
	TestModel,
	TestModelStats,
	TestRunResultDetails,
} from '../types/test-run';
import { isSameTestModel, testModelColorIndex, testResultModel } from '../types/test-run';
import { compareContextVariants } from '../utils/test-comparison';
import { buildTestDataDiff } from '../utils/test-data-comparison';
import { type SummarizedTestResult, summarizeModels } from '../utils/test-model-summary';
import { summarizeRunTests, type TestAttemptTotals, toAttemptCounts } from '../utils/test-run-totals';

const TEST_HISTORY_RUN_LIMIT = 10;
const PREVIOUS_SUMMARY_SCANNED_RUNS = 100;
const MODEL_STATS_WINDOW_MS = 30 * 24 * 60 * 60_000;

type TestRunResultWithDiff = DBTestRunResult & {
	dataDiff: TestDataDiff | null;
	/** On the attempt of a comparison with the user's changes, how its rows differ from the same attempt on production. */
	variantDiff: TestDataDiff | null;
};

type EarlierModelAttempt = Awaited<ReturnType<typeof testRunQueries.listEarlierModelAttempts>>[number];

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

interface LatestTestModelOutcome extends TestModel {
	/** Position of the model in the run's models, to list the models in their order. */
	runIndex: number;
	/** Position of the model among the distinct models of the run, which sets its color. */
	colorIndex: number;
	passedAttempts: number;
	totalAttempts: number;
}

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
	results: SummarizedTestResult[],
): Promise<PreviousTestModelSummary[]> {
	if (run.status !== 'completed' || run.trigger !== 'manual') {
		return [];
	}
	const earlierAttempts = await testRunQueries.listEarlierModelAttempts({
		projectId: run.projectId,
		createdBefore: run.createdAt,
		testPaths: [...new Set(results.map((result) => result.testPath))],
		models: run.models,
		scannedRuns: PREVIOUS_SUMMARY_SCANNED_RUNS,
	});
	return run.models.flatMap((model) => {
		const testPaths = new Set(resultsOfModel(results, model).map((result) => result.testPath));
		const previous = findPreviousModelSummary(earlierAttempts, model, testPaths);
		return previous ? [previous] : [];
	});
}

export async function getModelStats(projectId: string): Promise<TestModelStats[]> {
	return testRunQueries.listRecentModelStats(projectId, new Date(Date.now() - MODEL_STATS_WINDOW_MS));
}

/** The latest runs of a test, with an older one of them too when asked for, as when opened from a run of several tests. */
export async function getTestHistory(
	projectId: string,
	testPath: string,
	tolerances: TestComparisonTolerances,
	includedRunId?: string,
) {
	const runs = await listShownRunsOfTest(projectId, testPath, includedRunId);
	const results = await testRunQueries.listResultsOfTest(
		runs.map((run) => run.id),
		testPath,
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

async function listShownRunsOfTest(projectId: string, testPath: string, includedRunId: string | undefined) {
	const runs = await testRunQueries.listRunsOfTest(projectId, testPath, TEST_HISTORY_RUN_LIMIT);
	if (!includedRunId || runs.some((run) => run.id === includedRunId)) {
		return runs;
	}
	const includedRun = await testRunQueries.findRunOfTest(projectId, testPath, includedRunId);
	return includedRun ? [...runs, includedRun] : runs;
}

/**
 * Adds to each result the cell by cell diff of its stored rows with the reference ones, and on the attempts with the
 * user's changes, with the rows of the same attempt on production.
 */
function withDataDiffs(results: DBTestRunResult[], tolerances: TestComparisonTolerances): TestRunResultWithDiff[] {
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
			isSameTestModel(testResultModel(candidate), testResultModel(draftResult)),
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
		runModels: TestModel[];
		llmProvider: TestModel['provider'];
		llmModelId: string;
		reasoningEffort: ActiveEffort | null;
		passedAttempts: number;
		totalAttempts: number;
	},
) {
	const model = testResultModel(row);
	const existing = models.find((other) => isSameTestModel(model, other));
	if (existing) {
		existing.passedAttempts += row.passedAttempts;
		existing.totalAttempts += row.totalAttempts;
		return;
	}
	models.push({
		...model,
		runIndex: row.runModels.findIndex((other) => isSameTestModel(model, other)),
		colorIndex: testModelColorIndex(row.runModels, model),
		passedAttempts: row.passedAttempts,
		totalAttempts: row.totalAttempts,
	});
}

/** The newest earlier run whose attempts of the model cover all the tests, summed up over those tests only. */
function findPreviousModelSummary(
	earlierAttempts: EarlierModelAttempt[],
	model: TestModel,
	testPaths: Set<string>,
): PreviousTestModelSummary | null {
	if (testPaths.size === 0) {
		return null;
	}
	for (const runAttempts of groupAttemptsByRun(resultsOfModel(earlierAttempts, model))) {
		const ranTestPaths = new Set(runAttempts.map((attempt) => attempt.testPath));
		if ([...testPaths].every((testPath) => ranTestPaths.has(testPath))) {
			const [summary] = summarizeModels(runAttempts.filter((attempt) => testPaths.has(attempt.testPath)));
			return { runId: runAttempts[0].runId, runCreatedAt: runAttempts[0].runCreatedAt, summary };
		}
	}
	return null;
}

function groupAttemptsByRun(attempts: EarlierModelAttempt[]): EarlierModelAttempt[][] {
	const attemptsByRun = new Map<string, EarlierModelAttempt[]>();
	for (const attempt of attempts) {
		const runAttempts = attemptsByRun.get(attempt.runId) ?? [];
		runAttempts.push(attempt);
		attemptsByRun.set(attempt.runId, runAttempts);
	}
	return [...attemptsByRun.values()];
}

function resultsOfModel<T extends SummarizedTestResult>(results: T[], model: TestModel): T[] {
	return results.filter(
		(result) => result.contextVariant === 'production' && isSameTestModel(testResultModel(result), model),
	);
}

function toAttemptTotals(result: DBTestRunResult): TestAttemptTotals {
	return { ...testResultModel(result), contextVariant: result.contextVariant, ...toAttemptCounts(result) };
}
