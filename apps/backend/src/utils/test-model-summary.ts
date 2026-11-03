import { resultModel } from '@nao/shared/types';

import type { DBTestRunResult } from '../db/abstractSchema';
import { TEST_CONTEXT_VARIANTS, type TestModelSummary } from '../types/test-run';
import { countAttemptsByTest, toAttemptCounts } from './test-run-totals';

export type SummarizedTestResult = Pick<
	DBTestRunResult,
	| 'testPath'
	| 'llmProvider'
	| 'llmModelId'
	| 'contextVariant'
	| 'passed'
	| 'totalCost'
	| 'totalTokens'
	| 'durationMs'
	| 'toolCallCount'
>;

/**
 * Sums up the attempts of each model against each context variant, most accurate first, then the cheapest correct
 * answer, like the per-model summary of `nao test`.
 */
export function summarizeModels(results: SummarizedTestResult[]): TestModelSummary[] {
	const groups = new Map<string, SummarizedTestResult[]>();
	for (const result of results) {
		const key = [result.contextVariant, result.llmProvider, result.llmModelId].join('\u0000');
		groups.set(key, [...(groups.get(key) ?? []), result]);
	}
	return [...groups.values()].map(summarizeModel).sort(compareSummaries);
}

function summarizeModel(results: SummarizedTestResult[]): TestModelSummary {
	const [first] = results;
	const passedAttempts = results.filter((result) => result.passed).length;
	const totalCost = sumOrNull(results.map((result) => result.totalCost));
	const tests = [...countAttemptsByTest(results.map(toAttemptCounts)).values()];
	return {
		...resultModel(first),
		contextVariant: first.contextVariant,
		attempts: results.length,
		passedAttempts,
		testCount: tests.length,
		reliableTestCount: tests.filter((test) => test.passedAttempts === test.totalAttempts).length,
		totalCost,
		costPerQuestion: averageOrNull(results.map((result) => result.totalCost)),
		costPerCorrectAnswer: totalCost !== null && passedAttempts > 0 ? totalCost / passedAttempts : null,
		averageToolCalls: averageOrNull(results.map((result) => result.toolCallCount)),
		medianDurationMs: medianOrNull(results.map((result) => result.durationMs)),
		averageTokens: averageOrNull(results.map((result) => result.totalTokens)),
	};
}

function compareSummaries(left: TestModelSummary, right: TestModelSummary): number {
	return (
		TEST_CONTEXT_VARIANTS.indexOf(left.contextVariant) - TEST_CONTEXT_VARIANTS.indexOf(right.contextVariant) ||
		accuracy(right) - accuracy(left) ||
		compareNullsLast(left.costPerCorrectAnswer, right.costPerCorrectAnswer) ||
		left.modelId.localeCompare(right.modelId)
	);
}

function accuracy(summary: TestModelSummary): number {
	return summary.attempts === 0 ? 0 : summary.passedAttempts / summary.attempts;
}

function compareNullsLast(left: number | null, right: number | null): number {
	if (left === right) {
		return 0;
	}
	if (left === null) {
		return 1;
	}
	if (right === null) {
		return -1;
	}
	return left - right;
}

function recordedValues(values: (number | null)[]): number[] {
	return values.filter((value): value is number => value !== null);
}

function sumOrNull(values: (number | null)[]): number | null {
	const recorded = recordedValues(values);
	return recorded.length === 0 ? null : recorded.reduce((sum, value) => sum + value, 0);
}

function averageOrNull(values: (number | null)[]): number | null {
	const recorded = recordedValues(values);
	return recorded.length === 0 ? null : recorded.reduce((sum, value) => sum + value, 0) / recorded.length;
}

function medianOrNull(values: (number | null)[]): number | null {
	const recorded = recordedValues(values).sort((left, right) => left - right);
	if (recorded.length === 0) {
		return null;
	}
	const middle = Math.floor(recorded.length / 2);
	return recorded.length % 2 === 0 ? (recorded[middle - 1] + recorded[middle]) / 2 : recorded[middle];
}
