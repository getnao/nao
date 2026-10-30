import * as testRunQueries from '../queries/test-run.queries';
import type { TestContextVariant, TestDefinition } from '../types/test-run';
import type { TestVariantOutcome } from '../utils/test-comparison';

export type TestVariantTotals = Record<TestContextVariant, TestVariantOutcome>;

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

function emptyVariantTotals(): TestVariantTotals {
	return { production: { passed: 0, total: 0 }, draft: { passed: 0, total: 0 } };
}
