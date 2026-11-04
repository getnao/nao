import { isSameModel, type LlmSelectedModel } from '@nao/shared/types';

import type { TestContextVariant, TestRunTestTotals, TestRunVariantTotals } from '../types/test-run';

export interface AttemptCounts {
	passedAttempts: number;
	totalAttempts: number;
}

export interface TestAttemptCounts extends AttemptCounts {
	testPath: string;
}

export interface TestAttemptTotals extends LlmSelectedModel, TestAttemptCounts {
	contextVariant: TestContextVariant;
}

/**
 * The tests of a run per context variant, over all models and for each model, in the order of the run's models.
 * Over all models, a test passes only when every attempt of every model passes.
 */
export function summarizeRunTests(rows: TestAttemptTotals[], runModels: LlmSelectedModel[]): TestRunVariantTotals[] {
	const variants = [...new Set(rows.map((row) => row.contextVariant))].sort();
	return variants.map((contextVariant) => {
		const variantRows = rows.filter((row) => row.contextVariant === contextVariant);
		return {
			contextVariant,
			...countTests(variantRows),
			models: runModels
				.map((model) => ({ ...model, rows: variantRows.filter((row) => isSameModel(row, model)) }))
				.filter(({ rows: modelRows }) => modelRows.length > 0)
				.map(({ rows: modelRows, ...model }) => ({ ...model, ...countTests(modelRows) })),
		};
	});
}

/** Sums the attempts of each test, from rows that each count one or several attempts of a test. */
export function countAttemptsByTest(rows: TestAttemptCounts[]): Map<string, AttemptCounts> {
	const attemptsByTest = new Map<string, AttemptCounts>();
	for (const row of rows) {
		const attempts = attemptsByTest.get(row.testPath) ?? { passedAttempts: 0, totalAttempts: 0 };
		attempts.passedAttempts += row.passedAttempts;
		attempts.totalAttempts += row.totalAttempts;
		attemptsByTest.set(row.testPath, attempts);
	}
	return attemptsByTest;
}

export function toAttemptCounts(result: { testPath: string; passed: boolean }): TestAttemptCounts {
	return { testPath: result.testPath, passedAttempts: result.passed ? 1 : 0, totalAttempts: 1 };
}

export function sumAttemptCounts(counts: AttemptCounts[]): AttemptCounts {
	return {
		passedAttempts: sum(counts.map((count) => count.passedAttempts)),
		totalAttempts: sum(counts.map((count) => count.totalAttempts)),
	};
}

function countTests(rows: TestAttemptCounts[]): TestRunTestTotals {
	const tests = [...countAttemptsByTest(rows).values()];
	return {
		testCount: tests.length,
		passedTests: tests.filter((test) => test.totalAttempts > 0 && test.passedAttempts === test.totalAttempts)
			.length,
		flakyTests: tests.filter((test) => test.passedAttempts > 0 && test.passedAttempts < test.totalAttempts).length,
		...sumAttemptCounts(tests),
	};
}

function sum(values: number[]): number {
	return values.reduce((total, value) => total + value, 0);
}
