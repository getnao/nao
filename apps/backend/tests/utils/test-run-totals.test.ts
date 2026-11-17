import { describe, expect, it } from 'vitest';

import { summarizeRunTests, type TestAttemptTotals } from '../../src/utils/test-run-totals';

const SONNET = { provider: 'anthropic' as const, modelId: 'claude-sonnet-4-5' };
const HAIKU = { provider: 'anthropic' as const, modelId: 'claude-haiku-4-5' };

describe('summarizeRunTests', () => {
	it('passes a test only when all its attempts pass, and counts the ones that passed some as flaky', () => {
		const [production] = summarizeRunTests(
			[attempts('revenue.yml', 'production', SONNET, 3, 3), attempts('churn.yml', 'production', SONNET, 2, 3)],
			[SONNET],
		);

		expect(production).toMatchObject({ testCount: 2, passedTests: 1, flakyTests: 1, passedAttempts: 5 });
		expect(production.models).toEqual([
			{ ...SONNET, testCount: 2, passedTests: 1, flakyTests: 1, passedAttempts: 5, totalAttempts: 6 },
		]);
	});

	it('sums each context variant of a comparison apart, with its models in the order of the run', () => {
		const totals = summarizeRunTests(
			[
				attempts('revenue.yml', 'draft', SONNET, 0, 1),
				attempts('revenue.yml', 'production', SONNET, 1, 1),
				attempts('revenue.yml', 'production', HAIKU, 1, 1),
			],
			[HAIKU, SONNET],
		);

		expect(totals.map((variant) => [variant.contextVariant, variant.passedTests])).toEqual([
			['draft', 0],
			['production', 1],
		]);
		expect(totals[1].models.map((model) => model.modelId)).toEqual([HAIKU.modelId, SONNET.modelId]);
	});
});

function attempts(
	testPath: string,
	contextVariant: TestAttemptTotals['contextVariant'],
	model: typeof SONNET,
	passedAttempts: number,
	totalAttempts: number,
): TestAttemptTotals {
	return { ...model, testPath, contextVariant, passedAttempts, totalAttempts };
}
