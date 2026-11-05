// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ModelFrontierChart } from './test-model-frontier-chart';
import type { TestModelSummary, TestRunWithResults } from './test-run-types';

const OPUS = { provider: 'anthropic', modelId: 'claude-opus-5-5' } as const;
const HAIKU = { provider: 'anthropic', modelId: 'claude-haiku-5-5' } as const;

describe('ModelFrontierChart', () => {
	beforeEach(() => localStorage.clear());

	afterEach(cleanup);

	it('draws a line through the efforts of a model, labeled once, and shows the effort and values of the point hovered', () => {
		const { container } = render(
			<ModelFrontierChart
				run={run([
					summary({ ...OPUS, reasoningEffort: 'high' }, 9, 0.08),
					summary({ ...OPUS, reasoningEffort: 'low' }, 6, 0.02),
					summary(HAIKU, 5, 0.01),
				])}
			/>,
		);

		expect(container.querySelectorAll('polyline')).toHaveLength(1);
		expect(screen.getByText('claude-opus-5-5')).toBeTruthy();
		expect(screen.getByText('claude-haiku-5-5')).toBeTruthy();

		fireEvent.mouseEnter(screen.getByText('claude-opus-5-5'));
		expect(screen.getByText('high effort')).toBeTruthy();
		expect(container.querySelector('g.pointer-events-none')?.textContent).toBe('90%$0.08');
	});

	it('collapses the chart under its title, and stays collapsed for the next runs', () => {
		const models = [summary(OPUS, 9, 0.08), summary(HAIKU, 5, 0.01)];
		render(<ModelFrontierChart run={run(models)} />);
		const toggle = screen.getByRole('button', { name: 'Accuracy vs. cost' });

		fireEvent.click(toggle);
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(screen.queryByText('claude-opus-5-5')).toBeNull();

		cleanup();
		render(<ModelFrontierChart run={run(models)} />);
		expect(screen.queryByText('claude-opus-5-5')).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: 'Accuracy vs. cost' }));
		expect(screen.getByText('claude-opus-5-5')).toBeTruthy();
	});

	it('shows nothing when fewer than two points have a cost', () => {
		const { container } = render(<ModelFrontierChart run={run([summary(HAIKU, 5, 0.01)])} />);

		expect(container.innerHTML).toBe('');
	});
});

function run(modelSummaries: TestModelSummary[]): TestRunWithResults {
	return {
		trigger: 'manual',
		models: modelSummaries.map(({ provider, modelId, reasoningEffort }) => ({
			provider,
			modelId,
			reasoningEffort,
		})),
		modelSummaries,
	} as unknown as TestRunWithResults;
}

function summary(
	model: Pick<TestModelSummary, 'provider' | 'modelId' | 'reasoningEffort'>,
	passedAttempts: number,
	costPerQuestion: number,
): TestModelSummary {
	return {
		...model,
		contextVariant: 'production',
		attempts: 10,
		passedAttempts,
		testCount: 10,
		reliableTestCount: passedAttempts,
		totalCost: costPerQuestion * 10,
		costPerQuestion,
		costPerCorrectAnswer: null,
		averageToolCalls: null,
		medianDurationMs: null,
		averageTokens: null,
	};
}
