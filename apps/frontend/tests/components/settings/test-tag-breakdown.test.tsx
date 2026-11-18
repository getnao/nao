// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TestModel } from '@nao/backend/test-run';
import type { TestComparisonRow, TestRunWithResults } from '@/components/settings/test-run-types';
import { summarizeRunByTag, TestTagBreakdown, UNTAGGED } from '@/components/settings/test-tag-breakdown';

const OPUS: TestModel = { provider: 'anthropic', modelId: 'claude-opus-5-5' };
const HAIKU: TestModel = { provider: 'anthropic', modelId: 'claude-haiku-5-5' };

type Result = TestRunWithResults['results'][number];
type Comparison = NonNullable<TestRunWithResults['comparison']>;

describe('summarizeRunByTag', () => {
	it('counts a test under each of its tags, the weakest tag first and the untagged tests last', () => {
		const summaries = summarizeRunByTag(
			run({
				models: [OPUS],
				results: [
					result('mrr.yml', ['finance', 'sales'], OPUS, true),
					result('licenses.yml', ['sales'], OPUS, false),
					result('stock.yml', [], OPUS, false),
				],
			}),
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
		const [summary] = summarizeRunByTag(
			run({ models: [OPUS, HAIKU], results: [result('mrr.yml', ['finance'], OPUS, true)] }),
		);

		expect(summary.passedTests).toBe(0);
		expect(summary.models.map((entry) => [entry.model.modelId, entry.passedAttempts, entry.totalAttempts])).toEqual(
			[
				['claude-opus-5-5', 1, 1],
				['claude-haiku-5-5', 0, 0],
			],
		);
	});

	it('measures the user changes against the main branch, leaving out the tests the changes added', () => {
		const summaries = summarizeRunByTag(
			comparisonRun([
				{ testPath: 'mrr.yml', tags: ['finance'], production: false, draft: true, change: 'fixed' },
				{ testPath: 'arr.yml', tags: ['finance'], production: null, draft: false, change: 'new' },
			]),
		);

		expect(summaries).toHaveLength(1);
		expect(summaries[0]).toMatchObject({
			testCount: 2,
			passedAttempts: 1,
			totalAttempts: 1,
			baseline: { passedAttempts: 0, totalAttempts: 1 },
		});
	});

	it('keeps the untagged tests after a tag still waiting for its answers', () => {
		const summaries = summarizeRunByTag(
			comparisonRun([
				{ testPath: 'stock.yml', tags: [], production: true, draft: true, change: 'unchanged' },
				{ testPath: 'mrr.yml', tags: ['finance'], production: true, draft: null, change: 'pending' },
			]),
		);

		expect(summaries.map((summary) => summary.tag)).toEqual(['finance', UNTAGGED]);
	});
});

describe('TestTagBreakdown', () => {
	afterEach(cleanup);

	it('shows nothing when no test has a tag', () => {
		const { container } = renderBreakdown(
			run({ models: [OPUS], results: [result('mrr.yml', [], OPUS, true)] }),
			null,
			() => {},
		);

		expect(container.innerHTML).toBe('');
	});

	it.each([
		{ selectedTag: null, expected: 'sales' },
		{ selectedTag: 'sales', expected: null },
	])('picks $expected when the sales row is clicked with $selectedTag selected', ({ selectedTag, expected }) => {
		const onSelectTag = vi.fn();
		renderBreakdown(
			run({ models: [OPUS], results: [result('licenses.yml', ['sales'], OPUS, true)] }),
			selectedTag,
			onSelectTag,
		);

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

interface ComparedTest {
	testPath: string;
	tags: string[];
	/** Null when the side has no answer. */
	production: boolean | null;
	draft: boolean | null;
	change: TestComparisonRow['change'];
}

function comparisonRun(tests: ComparedTest[]): TestRunWithResults {
	const results = tests.flatMap((test) => [
		...(test.production === null ? [] : [result(test.testPath, test.tags, OPUS, test.production, 'production')]),
		...(test.draft === null ? [] : [result(test.testPath, test.tags, OPUS, test.draft, 'draft')]),
	]);
	return run({ trigger: 'comparison', models: [OPUS], results, comparison: compare(tests) });
}

function compare(tests: ComparedTest[]): Comparison {
	const rows = tests.map((test) => ({
		testPath: test.testPath,
		testName: test.testPath.replace('.yml', ''),
		production: countAnswer(test.production),
		draft: countAnswer(test.draft),
		change: test.change,
	}));
	const comparedRows = rows.filter((row) => row.change !== 'new');
	return {
		production: sumAnswers(comparedRows.map((row) => row.production)),
		draft: sumAnswers(comparedRows.map((row) => row.draft)),
		tests: rows,
	};
}

function countAnswer(passed: boolean | null) {
	return { passedAttempts: passed ? 1 : 0, totalAttempts: passed === null ? 0 : 1 };
}

function sumAnswers(counts: ReturnType<typeof countAnswer>[]) {
	return {
		passedAttempts: counts.reduce((sum, count) => sum + count.passedAttempts, 0),
		totalAttempts: counts.reduce((sum, count) => sum + count.totalAttempts, 0),
	};
}

function run(overrides: Partial<TestRunWithResults>): TestRunWithResults {
	const createdAt = new Date('2026-11-17T10:00:00Z');
	return {
		id: 'run-1',
		projectId: 'project-1',
		triggeredByUserId: null,
		trigger: 'manual',
		status: 'completed',
		contextRef: null,
		contextCommit: null,
		contextChanges: null,
		models: [OPUS],
		attempts: 1,
		selection: null,
		totalAttempts: 0,
		completedAttempts: 0,
		passedAttempts: 0,
		totalTokens: 0,
		totalCost: null,
		errorMessage: null,
		createdAt,
		startedAt: createdAt,
		completedAt: createdAt,
		heartbeatAt: createdAt,
		results: [],
		comparison: null,
		modelSummaries: [],
		previousModelSummaries: [],
		...overrides,
	};
}

function result(
	testPath: string,
	tags: string[],
	model: TestModel,
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
		llmConfigId: model.llmConfigId ?? null,
		reasoningEffort: null,
		contextVariant,
		passed,
		message: passed ? 'match' : 'values differ',
		errorMessage: null,
		totalTokens: null,
		totalCost: null,
		durationMs: null,
		toolCallCount: null,
	};
}
