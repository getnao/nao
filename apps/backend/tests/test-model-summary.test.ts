import { describe, expect, it } from 'vitest';

import type { TestContextVariant } from '../src/types/test-run';
import { type SummarizedTestResult, summarizeModels } from '../src/utils/test-model-summary';

describe('summarizeModels', () => {
	it('sums up each model over its attempts, the most accurate first', () => {
		const summaries = summarizeModels([
			attempt('haiku', 'revenue.yml', true, { totalCost: 0.01, durationMs: 1000, toolCallCount: 4 }),
			attempt('haiku', 'revenue.yml', false, { totalCost: 0.01, durationMs: 3000, toolCallCount: 8 }),
			attempt('haiku', 'orders.yml', true, { totalCost: 0.01, durationMs: 2000, toolCallCount: 6 }),
			attempt('sonnet', 'revenue.yml', true, { totalCost: 0.04, durationMs: 5000, toolCallCount: 3 }),
			attempt('sonnet', 'orders.yml', true, { totalCost: 0.06, durationMs: 7000, toolCallCount: 5 }),
		]);

		expect(summaries.map((summary) => summary.modelId)).toEqual(['sonnet', 'haiku']);
		expect(summaries[1]).toEqual({
			provider: 'anthropic',
			modelId: 'haiku',
			reasoningEffort: null,
			contextVariant: 'production',
			attempts: 3,
			passedAttempts: 2,
			testCount: 2,
			reliableTestCount: 1,
			totalCost: expect.closeTo(0.03),
			costPerQuestion: expect.closeTo(0.01),
			costPerCorrectAnswer: expect.closeTo(0.015),
			averageToolCalls: 6,
			medianDurationMs: 2000,
			averageTokens: null,
		});
	});

	it('sums up each reasoning effort of a model apart', () => {
		const summaries = summarizeModels([
			attempt('opus', 'revenue.yml', false, { reasoningEffort: 'low', totalCost: 0.01 }),
			attempt('opus', 'revenue.yml', true, { reasoningEffort: 'high', totalCost: 0.05 }),
		]);

		expect(summaries).toMatchObject([
			{ modelId: 'opus', reasoningEffort: 'high', passedAttempts: 1, costPerQuestion: 0.05 },
			{ modelId: 'opus', reasoningEffort: 'low', passedAttempts: 0, costPerQuestion: 0.01 },
		]);
	});

	it('summarizes separate credentials for the same model independently', () => {
		const summaries = summarizeModels([
			attempt('opus', 'revenue.yml', true, { llmConfigId: 'config-a' }),
			attempt('opus', 'revenue.yml', false, { llmConfigId: 'config-b' }),
		]);

		expect(summaries).toMatchObject([
			{ modelId: 'opus', llmConfigId: 'config-a', passedAttempts: 1 },
			{ modelId: 'opus', llmConfigId: 'config-b', passedAttempts: 0 },
		]);
	});

	it('ranks equally accurate models by the cost of a correct answer', () => {
		const summaries = summarizeModels([
			attempt('sonnet', 'revenue.yml', true, { totalCost: 0.05 }),
			attempt('haiku', 'revenue.yml', true, { totalCost: 0.01 }),
		]);

		expect(summaries.map((summary) => summary.modelId)).toEqual(['haiku', 'sonnet']);
	});

	it('leaves the costs unknown when no attempt recorded one, and ranks that model after the priced ones', () => {
		const summaries = summarizeModels([
			attempt('local', 'revenue.yml', true, {}),
			attempt('haiku', 'revenue.yml', true, { totalCost: 0.01 }),
		]);

		expect(summaries.map((summary) => summary.modelId)).toEqual(['haiku', 'local']);
		expect(summaries[1]).toMatchObject({ totalCost: null, costPerQuestion: null, costPerCorrectAnswer: null });
	});

	it('has no cost per correct answer when no attempt passed', () => {
		const [summary] = summarizeModels([attempt('haiku', 'revenue.yml', false, { totalCost: 0.01 })]);

		expect(summary.costPerCorrectAnswer).toBeNull();
	});

	it('summarizes each context variant apart, production first', () => {
		const summaries = summarizeModels([
			attempt('haiku', 'revenue.yml', true, {}, 'draft'),
			attempt('haiku', 'revenue.yml', false, {}, 'production'),
		]);

		expect(summaries.map((summary) => [summary.contextVariant, summary.passedAttempts])).toEqual([
			['production', 0],
			['draft', 1],
		]);
	});

	it('takes the middle of an even number of durations as their median', () => {
		const [summary] = summarizeModels([
			attempt('haiku', 'revenue.yml', true, { durationMs: 1000 }),
			attempt('haiku', 'revenue.yml', true, { durationMs: 4000 }),
			attempt('haiku', 'revenue.yml', true, { durationMs: 2000 }),
			attempt('haiku', 'revenue.yml', true, { durationMs: 9000 }),
		]);

		expect(summary.medianDurationMs).toBe(3000);
	});
});

function attempt(
	modelId: string,
	testPath: string,
	passed: boolean,
	metrics: Partial<
		Pick<
			SummarizedTestResult,
			'totalCost' | 'totalTokens' | 'durationMs' | 'toolCallCount' | 'reasoningEffort' | 'llmConfigId'
		>
	>,
	contextVariant: TestContextVariant = 'production',
): SummarizedTestResult {
	return {
		testPath,
		llmProvider: 'anthropic',
		llmModelId: modelId,
		llmConfigId: null,
		reasoningEffort: null,
		contextVariant,
		passed,
		totalCost: null,
		totalTokens: null,
		durationMs: null,
		toolCallCount: null,
		...metrics,
	};
}
