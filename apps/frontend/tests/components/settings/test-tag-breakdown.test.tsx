// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TestRunWithResults } from '@/components/settings/test-run-types';
import { summarizeRunByTag, TestTagBreakdown, UNTAGGED } from '@/components/settings/test-tag-breakdown';

const OPUS = { provider: 'anthropic', modelId: 'claude-opus-5-5' } as const;
const HAIKU = { provider: 'anthropic', modelId: 'claude-haiku-5-5' } as const;

type Result = TestRunWithResults['results'][number];

describe('summarizeRunByTag', () => {
	it('counts a test under each of its tags, the weakest tag first and the untagged tests last', () => {
		const summaries = summarizeRunByTag(
			run(
				[OPUS],
				[
					result('mrr.yml', ['finance', 'sales'], OPUS, true),
					result('licenses.yml', ['sales'], OPUS, false),
					result('stock.yml', [], OPUS, false),
				],
			),
		);

		expect(
			summaries.map(({ tag, testCount, passedTests, passedAttempts, totalAttempts }) => ({
				tag,
				testCount,
				passedTests,
				passedAttempts,
				totalAttempts,
			})),
		).toEqual([
			{ tag: 'sales', testCount: 2, passedTests: 1, passedAttempts: 1, totalAttempts: 2 },
			{ tag: 'finance', testCount: 1, passedTests: 1, passedAttempts: 1, totalAttempts: 1 },
			{ tag: UNTAGGED, testCount: 1, passedTests: 0, passedAttempts: 0, totalAttempts: 1 },
		]);
	});

	it('counts each model on its own and a test as passed only once every expected answer passed', () => {
		const [summary] = summarizeRunByTag(run([OPUS, HAIKU], [result('mrr.yml', ['finance'], OPUS, true)]));

		expect(summary.passedTests).toBe(0);
		expect(summary.models.map((entry) => [entry.model.modelId, entry.passedAttempts, entry.totalAttempts])).toEqual(
			[
				['claude-opus-5-5', 1, 1],
				['claude-haiku-5-5', 0, 0],
			],
		);
	});

	it('measures the user changes against the main branch in a comparison', () => {
		const [summary] = summarizeRunByTag(
			run(
				[OPUS],
				[
					result('mrr.yml', ['finance'], OPUS, false, 'production'),
					result('mrr.yml', ['finance'], OPUS, true, 'draft'),
				],
				{ comparison: {} },
			),
		);

		expect(summary.baseline).toEqual({ passedAttempts: 0, totalAttempts: 1 });
		expect([summary.passedAttempts, summary.totalAttempts]).toEqual([1, 1]);
	});
});

describe('TestTagBreakdown', () => {
	afterEach(cleanup);

	it('shows nothing when no test has a tag', () => {
		const { container } = renderBreakdown(run([OPUS], [result('mrr.yml', [], OPUS, true)]), null, () => {});

		expect(container.innerHTML).toBe('');
	});

	it.each([
		{ selectedTag: null, expected: 'sales' },
		{ selectedTag: 'sales', expected: null },
	])('picks $expected when the sales row is clicked with $selectedTag selected', ({ selectedTag, expected }) => {
		const onSelectTag = vi.fn();
		renderBreakdown(run([OPUS], [result('licenses.yml', ['sales'], OPUS, true)]), selectedTag, onSelectTag);

		fireEvent.click(screen.getByText('sales'));

		expect(onSelectTag).toHaveBeenCalledWith(expected);
	});
});

function renderBreakdown(
	testRun: TestRunWithResults,
	selectedTag: string | null,
	onSelectTag: (tag: string | null) => void,
) {
	return render(
		<TestTagBreakdown run={testRun} mainBranch='main' selectedTag={selectedTag} onSelectTag={onSelectTag} />,
	);
}

function run(
	models: TestRunWithResults['models'],
	results: Result[],
	overrides: Partial<Record<'comparison', unknown>> = {},
): TestRunWithResults {
	return {
		trigger: overrides.comparison ? 'comparison' : 'manual',
		attempts: 1,
		models,
		results,
		comparison: null,
		...overrides,
	} as unknown as TestRunWithResults;
}

function result(
	testPath: string,
	tags: string[],
	model: TestRunWithResults['models'][number],
	passed: boolean,
	contextVariant: Result['contextVariant'] = 'production',
): Result {
	return {
		id: `${testPath}:${model.modelId}:${contextVariant}`,
		testPath,
		testName: testPath.replace('.yml', ''),
		tags,
		llmProvider: model.provider,
		llmModelId: model.modelId,
		reasoningEffort: null,
		contextVariant,
		passed,
		totalCost: null,
		durationMs: null,
	} as Result;
}
