import type { DBTestRunResult } from '../db/abstractSchema';
import * as testRunQueries from '../queries/test-run.queries';
import type {
	TestComparisonTolerances,
	TestContextVariant,
	TestDataDiff,
	TestDefinition,
	TestRunResultDetails,
} from '../types/test-run';
import { compareContextVariants, type TestVariantOutcome } from '../utils/test-comparison';
import { buildTestDataDiff } from '../utils/test-data-comparison';

const TEST_HISTORY_RUN_LIMIT = 10;
const TEST_HISTORY_SCANNED_RUNS = 100;

export type TestVariantTotals = Record<TestContextVariant, TestVariantOutcome>;

export type TestRunResultWithDiff = DBTestRunResult & { dataDiff: TestDataDiff | null };

export interface LatestTestOutcome {
	runId: string;
	runCreatedAt: Date;
	passedAttempts: number;
	totalAttempts: number;
	/** The test file changed after this run, so the outcome may no longer hold. */
	isOutdated: boolean;
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
			isOutdated: false,
		});
		if (outcome.runId !== row.runId) {
			continue;
		}
		outcome.totalAttempts += row.totalAttempts;
		outcome.passedAttempts += row.passedAttempts;
		outcome.isOutdated ||= row.testHash !== hashByPath.get(row.testPath);
	}

	return outcomes;
}

/** The latest runs of the project, with the outcome of each variant for the comparison runs. */
export async function listRunsWithVariantTotals(projectId: string) {
	const runs = await testRunQueries.listRuns(projectId);
	const comparisonRunIds = runs.filter((run) => run.trigger === 'comparison').map((run) => run.id);
	const totalsByRun = new Map<string, TestVariantTotals>();
	for (const row of await testRunQueries.listVariantTotals(comparisonRunIds)) {
		const totals = totalsByRun.get(row.runId) ?? emptyVariantTotals();
		totals[row.contextVariant] = { passed: row.passed, total: row.total };
		totalsByRun.set(row.runId, totals);
	}
	return runs.map((run) => ({
		...run,
		variantTotals: run.trigger === 'comparison' ? (totalsByRun.get(run.id) ?? emptyVariantTotals()) : null,
	}));
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

function emptyVariantTotals(): TestVariantTotals {
	return { production: { passed: 0, total: 0 }, draft: { passed: 0, total: 0 } };
}
