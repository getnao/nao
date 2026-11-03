import type { LlmSelectedModel } from '@nao/shared/types';

import type { TestContextVariant, TestRunTestTotals, TestRunVariantTotals } from '../types/test-run';
import { isSameModelSummary } from './test-model-summary';

export interface TestAttemptTotals extends LlmSelectedModel {
	testPath: string;
	contextVariant: TestContextVariant;
	passedAttempts: number;
	totalAttempts: number;
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
			...countTests(sumAttemptsByTest(variantRows)),
			models: runModels
				.map((model) => ({ ...model, rows: variantRows.filter((row) => isSameModelSummary(row, model)) }))
				.filter(({ rows: modelRows }) => modelRows.length > 0)
				.map(({ rows: modelRows, ...model }) => ({ ...model, ...countTests(sumAttemptsByTest(modelRows)) })),
		};
	});
}

function sumAttemptsByTest(rows: TestAttemptTotals[]): { passedAttempts: number; totalAttempts: number }[] {
	const attemptsByTest = new Map<string, { passedAttempts: number; totalAttempts: number }>();
	for (const row of rows) {
		const attempts = attemptsByTest.get(row.testPath) ?? { passedAttempts: 0, totalAttempts: 0 };
		attempts.passedAttempts += row.passedAttempts;
		attempts.totalAttempts += row.totalAttempts;
		attemptsByTest.set(row.testPath, attempts);
	}
	return [...attemptsByTest.values()];
}

function countTests(tests: { passedAttempts: number; totalAttempts: number }[]): TestRunTestTotals {
	return {
		testCount: tests.length,
		passedTests: tests.filter((test) => test.totalAttempts > 0 && test.passedAttempts === test.totalAttempts)
			.length,
		flakyTests: tests.filter((test) => test.passedAttempts > 0 && test.passedAttempts < test.totalAttempts).length,
		passedAttempts: sum(tests.map((test) => test.passedAttempts)),
		totalAttempts: sum(tests.map((test) => test.totalAttempts)),
	};
}

function sum(values: number[]): number {
	return values.reduce((total, value) => total + value, 0);
}
