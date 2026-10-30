import type { DBTestRunResult } from '../db/abstractSchema';

export const TEST_COMPARISON_CHANGES = ['regressed', 'worsened', 'fixed', 'improved', 'unchanged', 'pending'] as const;
export type TestComparisonChange = (typeof TEST_COMPARISON_CHANGES)[number];

export interface TestVariantOutcome {
	passed: number;
	total: number;
}

export interface TestComparisonRow {
	testPath: string;
	testName: string;
	production: TestVariantOutcome;
	draft: TestVariantOutcome;
	change: TestComparisonChange;
}

export interface TestComparison {
	production: TestVariantOutcome;
	draft: TestVariantOutcome;
	counts: Record<TestComparisonChange, number>;
	/** Tests sorted by change, regressions first, so the ones to look at come on top. */
	tests: TestComparisonRow[];
}

type ComparedResult = Pick<DBTestRunResult, 'testPath' | 'testName' | 'contextVariant' | 'passed'>;

/**
 * Compares, test by test, the attempts that ran against production with those that ran against the draft.
 * A test stays pending until both variants have all their attempts.
 */
export function compareContextVariants(results: ComparedResult[], attemptsPerVariant: number): TestComparison {
	const rows = new Map<string, TestComparisonRow>();
	for (const result of results) {
		const row = rows.get(result.testPath) ?? createRow(result);
		const outcome = row[result.contextVariant];
		outcome.total++;
		outcome.passed += result.passed ? 1 : 0;
		rows.set(result.testPath, row);
	}

	const tests = [...rows.values()]
		.map((row) => ({ ...row, change: classifyChange(row, attemptsPerVariant) }))
		.sort(
			(left, right) =>
				TEST_COMPARISON_CHANGES.indexOf(left.change) - TEST_COMPARISON_CHANGES.indexOf(right.change) ||
				left.testName.localeCompare(right.testName),
		);
	return {
		production: sumOutcomes(tests.map((test) => test.production)),
		draft: sumOutcomes(tests.map((test) => test.draft)),
		counts: countChanges(tests),
		tests,
	};
}

function createRow(result: ComparedResult): TestComparisonRow {
	return {
		testPath: result.testPath,
		testName: result.testName,
		production: { passed: 0, total: 0 },
		draft: { passed: 0, total: 0 },
		change: 'pending',
	};
}

function classifyChange(row: TestComparisonRow, attemptsPerVariant: number): TestComparisonChange {
	if (row.production.total < attemptsPerVariant || row.draft.total < attemptsPerVariant) {
		return 'pending';
	}
	const productionRate = row.production.passed / row.production.total;
	const draftRate = row.draft.passed / row.draft.total;
	if (draftRate > productionRate) {
		return productionRate === 0 && draftRate === 1 ? 'fixed' : 'improved';
	}
	if (draftRate < productionRate) {
		return productionRate === 1 && draftRate === 0 ? 'regressed' : 'worsened';
	}
	return 'unchanged';
}

function sumOutcomes(outcomes: TestVariantOutcome[]): TestVariantOutcome {
	return outcomes.reduce(
		(sum, outcome) => ({ passed: sum.passed + outcome.passed, total: sum.total + outcome.total }),
		{
			passed: 0,
			total: 0,
		},
	);
}

function countChanges(tests: TestComparisonRow[]): Record<TestComparisonChange, number> {
	const counts = Object.fromEntries(TEST_COMPARISON_CHANGES.map((change) => [change, 0])) as Record<
		TestComparisonChange,
		number
	>;
	for (const test of tests) {
		counts[test.change]++;
	}
	return counts;
}
