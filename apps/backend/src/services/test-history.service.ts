import * as testRunQueries from '../queries/test-run.queries';
import type { TestDefinition } from '../types/test-run';

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
