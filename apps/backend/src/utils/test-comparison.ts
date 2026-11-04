import type { DBTestRunResult } from '../db/abstractSchema';
import type { TestContextVariant } from '../types/test-run';
import { type AttemptCounts, countAttemptsByTest, sumAttemptCounts, toAttemptCounts } from './test-run-totals';

const TEST_COMPARISON_CHANGES = ['regressed', 'worsened', 'fixed', 'improved', 'unchanged', 'pending'] as const;
type TestComparisonChange = (typeof TEST_COMPARISON_CHANGES)[number];

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

type ComparedResult = Pick<DBTestRunResult, 'testPath' | 'testName' | 'contextVariant' | 'passed'>;

const NO_ATTEMPTS: AttemptCounts = { passedAttempts: 0, totalAttempts: 0 };

/**
 * Compares, test by test, the attempts that ran against production with those that ran against the draft.
 * A test stays pending until both variants have all their attempts.
 */
export function compareContextVariants(results: ComparedResult[], attemptsPerVariant: number): TestComparison {
	const production = countVariantAttempts(results, 'production');
	const draft = countVariantAttempts(results, 'draft');
	const testNames = new Map(results.map((result) => [result.testPath, result.testName]));

	const tests = [...testNames]
		.map(([testPath, testName]) => {
			const outcomes = {
				production: production.get(testPath) ?? NO_ATTEMPTS,
				draft: draft.get(testPath) ?? NO_ATTEMPTS,
			};
			return { testPath, testName, ...outcomes, change: classifyChange(outcomes, attemptsPerVariant) };
		})
		.sort(
			(left, right) =>
				TEST_COMPARISON_CHANGES.indexOf(left.change) - TEST_COMPARISON_CHANGES.indexOf(right.change) ||
				left.testName.localeCompare(right.testName),
		);
	return {
		production: sumAttemptCounts(tests.map((test) => test.production)),
		draft: sumAttemptCounts(tests.map((test) => test.draft)),
		tests,
	};
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
