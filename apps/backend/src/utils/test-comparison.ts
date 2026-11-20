import { toTestPath } from '@nao/shared/test-paths';

import type { DBTestRunResult } from '../db/abstractSchema';
import type { TestContextChange, TestContextVariant } from '../types/test-run';
import { type AttemptCounts, countAttemptsByTest, sumAttemptCounts, toAttemptCounts } from './test-run-totals';

const TEST_COMPARISON_CHANGES = [
	'regressed',
	'worsened',
	'fixed',
	'improved',
	'new',
	'removed',
	'unchanged',
	'pending',
] as const;
type TestComparisonChange = (typeof TEST_COMPARISON_CHANGES)[number];

/** The side a test runs on when the changes add or delete it, as the other side does not have it. */
const ONE_SIDED_CHANGE_VARIANTS: Partial<Record<TestContextChange['kind'], TestContextVariant>> = {
	added: 'draft',
	deleted: 'production',
};
const ONE_SIDED_CHANGES: Record<TestContextVariant, TestComparisonChange> = { draft: 'new', production: 'removed' };

interface TestComparisonRow {
	testPath: string;
	testName: string;
	production: AttemptCounts;
	draft: AttemptCounts;
	change: TestComparisonChange;
}

interface TestComparison {
	production: AttemptCounts;
	draft: AttemptCounts;
	/** Tests sorted by change, regressions first, so the ones to look at come on top. */
	tests: TestComparisonRow[];
}

export type OneSidedTests = ReadonlyMap<string, TestContextVariant>;

type ComparedResult = Pick<DBTestRunResult, 'testPath' | 'testName' | 'contextVariant' | 'passed'>;

const NO_ATTEMPTS: AttemptCounts = { passedAttempts: 0, totalAttempts: 0 };

/**
 * Compares, test by test, the attempts that ran against production with those that ran against the draft.
 * A test stays pending until both variants have all their attempts, except a test the draft adds or deletes, which
 * only runs on the side that has it and so stays out of the totals of both sides.
 */
export function compareContextVariants(
	results: ComparedResult[],
	attemptsPerVariant: number,
	oneSidedTests: OneSidedTests = new Map(),
): TestComparison {
	const production = countVariantAttempts(results, 'production');
	const draft = countVariantAttempts(results, 'draft');
	const testNames = new Map(results.map((result) => [result.testPath, result.testName]));

	const tests = [...testNames]
		.map(([testPath, testName]) => {
			const outcomes = {
				production: production.get(testPath) ?? NO_ATTEMPTS,
				draft: draft.get(testPath) ?? NO_ATTEMPTS,
			};
			const side = oneSidedTests.get(testPath);
			const change = side ? ONE_SIDED_CHANGES[side] : classifyChange(outcomes, attemptsPerVariant);
			return { testPath, testName, ...outcomes, change };
		})
		.sort(
			(left, right) =>
				TEST_COMPARISON_CHANGES.indexOf(left.change) - TEST_COMPARISON_CHANGES.indexOf(right.change) ||
				left.testName.localeCompare(right.testName),
		);
	const comparedTests = tests.filter((test) => !oneSidedTests.has(test.testPath));
	return {
		production: sumAttemptCounts(comparedTests.map((test) => test.production)),
		draft: sumAttemptCounts(comparedTests.map((test) => test.draft)),
		tests,
	};
}

/** The results of a comparison that both sides ran, leaving out the tests the changes add or delete. */
export function listComparedResults<Result extends Pick<DBTestRunResult, 'testPath'>>(
	results: Result[],
	oneSidedTests: OneSidedTests,
): Result[] {
	return results.filter((result) => !oneSidedTests.has(result.testPath));
}

/**
 * The tests a run's changes add or delete, with the only side that has them: an added test runs with the changes
 * only, a deleted one against production only.
 */
export function listOneSidedTests(changes: TestContextChange[] | null): Map<string, TestContextVariant> {
	return new Map(
		(changes ?? []).flatMap((change) => {
			const testPath = toTestPath(change.path);
			const side = ONE_SIDED_CHANGE_VARIANTS[change.kind];
			return testPath && side ? [[testPath, side] as const] : [];
		}),
	);
}

function countVariantAttempts(results: ComparedResult[], variant: TestContextVariant): Map<string, AttemptCounts> {
	return countAttemptsByTest(results.filter((result) => result.contextVariant === variant).map(toAttemptCounts));
}

function classifyChange(
	{ production, draft }: Pick<TestComparisonRow, 'production' | 'draft'>,
	attemptsPerVariant: number,
): TestComparisonChange {
	if (production.totalAttempts < attemptsPerVariant || draft.totalAttempts < attemptsPerVariant) {
		return 'pending';
	}
	const productionRate = production.passedAttempts / production.totalAttempts;
	const draftRate = draft.passedAttempts / draft.totalAttempts;
	if (draftRate > productionRate) {
		return productionRate === 0 && draftRate === 1 ? 'fixed' : 'improved';
	}
	if (draftRate < productionRate) {
		return productionRate === 1 && draftRate === 0 ? 'regressed' : 'worsened';
	}
	return 'unchanged';
}
