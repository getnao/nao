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

/** The outcome of each test in the latest run that included it. */
export async function getLatestOutcomesByTest(
	projectId: string,
	tests: TestDefinition[],
): Promise<Record<string, LatestTestOutcome>> {
	const hashByPath = new Map(tests.map((test) => [test.path, test.hash]));
	const outcomes: Record<string, LatestTestOutcome> = {};

	for (const result of await testRunQueries.listRecentResultOutcomes(projectId)) {
		const currentHash = hashByPath.get(result.testPath);
		if (currentHash === undefined) {
			continue;
		}
		const outcome = (outcomes[result.testPath] ??= {
			runId: result.runId,
			runCreatedAt: result.runCreatedAt,
			passedAttempts: 0,
			totalAttempts: 0,
			isOutdated: false,
		});
		if (outcome.runId !== result.runId) {
			continue;
		}
		outcome.totalAttempts += 1;
		outcome.passedAttempts += result.passed ? 1 : 0;
		outcome.isOutdated ||= result.testHash !== currentHash;
	}

	return outcomes;
}
