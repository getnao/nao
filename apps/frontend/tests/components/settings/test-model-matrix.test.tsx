// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { TestRunWithResults } from '@/components/settings/test-run-types';
import { TestModelMatrix } from '@/components/settings/test-model-matrix';

const OPUS = { provider: 'anthropic', modelId: 'claude-opus-5-5' } as const;
const HAIKU = { provider: 'anthropic', modelId: 'claude-haiku-5-5' } as const;

describe('TestModelMatrix', () => {
	afterEach(cleanup);

	it('shows a row per model under each test and a column per reasoning effort', () => {
		render(
			<TestModelMatrix
				run={run(
					[{ ...OPUS, reasoningEffort: 'high' }, { ...OPUS, reasoningEffort: 'low' }, HAIKU],
					[
						result('revenue.yml', { ...OPUS, reasoningEffort: 'low' }, false),
						result('revenue.yml', { ...OPUS, reasoningEffort: 'high' }, true),
						result('revenue.yml', HAIKU, true),
					],
				)}
				testPaths={['revenue.yml']}
				onOpenTest={() => {}}
			/>,
		);

		const rows = screen.getAllByRole('row') as HTMLTableRowElement[];
		expect([...rows[0].cells].map((cell) => cell.textContent)).toEqual([
			'Test',
			'Model',
			'Default',
			'low',
			'high',
			'',
		]);
		expect(rows.slice(1).map((row) => [...row.cells].map((cell) => cell.textContent))).toEqual([
			['revenue', 'claude-opus-5-5', '', '0/1', '', ''],
			['claude-haiku-5-5', '', '', '', ''],
		]);
		expect(within(rows[1]).getByLabelText('1 of 1 answers passed')).toBeTruthy();
	});
});

function run(models: TestRunWithResults['models'], results: TestRunWithResults['results']): TestRunWithResults {
	return { trigger: 'manual', attempts: 1, models, results } as unknown as TestRunWithResults;
}

function result(
	testPath: string,
	model: TestRunWithResults['models'][number],
	passed: boolean,
): TestRunWithResults['results'][number] {
	return {
		id: `${testPath}:${model.modelId}:${model.reasoningEffort ?? ''}`,
		testPath,
		testName: testPath.replace('.yml', ''),
		llmProvider: model.provider,
		llmModelId: model.modelId,
		reasoningEffort: model.reasoningEffort ?? null,
		contextVariant: 'production',
		passed,
	} as TestRunWithResults['results'][number];
}
