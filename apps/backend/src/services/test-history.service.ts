import type { LlmSelectedModel } from '@nao/shared/types';

import type { DBTestRun, DBTestRunResult } from '../db/abstractSchema';
import * as testRunQueries from '../queries/test-run.queries';
import type {
	PreviousTestModelSummary,
	TestComparisonTolerances,
	TestContextVariant,
	TestDataDiff,
	TestDefinition,
	TestModelStats,
	TestRunResultDetails,
} from '../types/test-run';
import { compareContextVariants, type TestVariantOutcome } from '../utils/test-comparison';
import { buildTestDataDiff } from '../utils/test-data-comparison';
import { isSameModelSummary, summarizeModels } from '../utils/test-model-summary';

const TEST_HISTORY_RUN_LIMIT = 10;
const TEST_HISTORY_SCANNED_RUNS = 100;
const MODEL_STATS_WINDOW_MS = 30 * 24 * 60 * 60_000;

export type TestVariantTotals = Record<TestContextVariant, TestVariantOutcome>;

export type TestRunResultWithDiff = DBTestRunResult & { dataDiff: TestDataDiff | null };

export interface LatestTestOutcome {
	runId: string;
	runCreatedAt: Date;
	passedAttempts: number;
	totalAttempts: number;
	/** The outcome of each model of that run, as a run can try several, in the order of the run's models. */
	models: LatestTestModelOutcome[];
	/** The test file changed after this run, so the outcome may no longer hold. */
	isOutdated: boolean;
}

export interface LatestTestModelOutcome extends LlmSelectedModel {
	/** Position of the model in the run's models, which sets its color. */
	runIndex: number;
	passedAttempts: number;
	totalAttempts: number;
}

export interface TestRunModelTotals extends LlmSelectedModel {
	contextVariant: TestContextVariant;
	passed: number;
	total: number;
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

/**
 * The latest runs of the project, with the outcome of each variant for the comparison runs, and of each model for
 * the runs that tried several.
 */
export async function listRunsWithVariantTotals(projectId: string) {
	const runs = await testRunQueries.listRuns(projectId);
	const comparisonRunIds = runs.filter((run) => run.trigger === 'comparison').map((run) => run.id);
	const multiModelRunIds = runs.filter((run) => run.models.length > 1).map((run) => run.id);
	const [variantRows, modelRows] = await Promise.all([
		testRunQueries.listVariantTotals(comparisonRunIds),
		testRunQueries.listModelTotals(multiModelRunIds),
	]);

	const variantTotalsByRun = new Map<string, TestVariantTotals>();
	for (const row of variantRows) {
		const totals = variantTotalsByRun.get(row.runId) ?? emptyVariantTotals();
		totals[row.contextVariant] = { passed: row.passed, total: row.total };
		variantTotalsByRun.set(row.runId, totals);
	}
	const modelTotalsByRun = new Map<string, TestRunModelTotals[]>();
	for (const { runId, ...totals } of modelRows) {
		modelTotalsByRun.set(runId, [...(modelTotalsByRun.get(runId) ?? []), totals]);
	}

	return runs.map((run) => ({
		...run,
		variantTotals: run.trigger === 'comparison' ? (variantTotalsByRun.get(run.id) ?? emptyVariantTotals()) : null,
		modelTotals: run.models.length > 1 ? (modelTotalsByRun.get(run.id) ?? []) : null,
	}));
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
			for (const candidate of earlierRuns.filter((earlier) => earlier.models.some(isSameModel(model)))) {
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
			attemptsPerVariant,
			comparison:
				run.trigger === 'comparison'
					? (compareContextVariants(results, attemptsPerVariant).tests.at(0) ?? null)
					: null,
		};
	});
}

/** Adds to each result the cell by cell diff of its stored rows. */
export function withDataDiffs(
	results: DBTestRunResult[],
	tolerances: TestComparisonTolerances,
): TestRunResultWithDiff[] {
	return results.map((result) => ({ ...result, dataDiff: buildResultDataDiff(result.details, tolerances) }));
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
	const model = { provider: row.llmProvider, modelId: row.llmModelId };
	const existing = models.find(isSameModel(model));
	if (existing) {
		existing.passedAttempts += row.passedAttempts;
		existing.totalAttempts += row.totalAttempts;
		return;
	}
	models.push({
		...model,
		runIndex: row.runModels.findIndex(isSameModel(model)),
		passedAttempts: row.passedAttempts,
		totalAttempts: row.totalAttempts,
	});
}

function resultsOfModel(results: DBTestRunResult[], model: LlmSelectedModel): DBTestRunResult[] {
	return results.filter(
		(result) =>
			result.contextVariant === 'production' &&
			isSameModelSummary({ provider: result.llmProvider, modelId: result.llmModelId }, model),
	);
}

function isSameModel(model: LlmSelectedModel) {
	return (other: LlmSelectedModel) => isSameModelSummary(model, other);
}

function emptyVariantTotals(): TestVariantTotals {
	return { production: { passed: 0, total: 0 }, draft: { passed: 0, total: 0 } };
}
