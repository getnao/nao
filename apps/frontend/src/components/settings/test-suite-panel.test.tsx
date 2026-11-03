// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TestSuitePanel } from './test-suite-panel';
import { TooltipProvider } from '@/components/ui/tooltip';

const mocks = vi.hoisted(() => ({ getRun: vi.fn(), listTests: vi.fn() }));

vi.mock('@/main', () => ({
	trpc: {
		testRun: {
			listTests: {
				queryOptions: () => ({ queryKey: ['tests'], queryFn: mocks.listTests }),
			},
			getRun: {
				queryOptions: (input: { runId: string }) => ({
					queryKey: ['test-run', input.runId],
					queryFn: mocks.getRun,
				}),
			},
		},
	},
}));

describe('TestSuitePanel', () => {
	beforeEach(() => {
		mocks.listTests.mockResolvedValue({
			tests: [],
			invalidFiles: [],
			latestOutcomes: {},
			settings: { errors: [] },
		});
	});

	afterEach(cleanup);

	it('shows the outcome of each test of a run first and filters the tests that passed or failed', async () => {
		mocks.getRun.mockResolvedValue({
			id: 'run-1',
			status: 'completed',
			models: [{ provider: 'anthropic', modelId: 'claude-sonnet-5' }],
			attempts: 1,
			completedAttempts: 2,
			totalAttempts: 2,
			errorMessage: null,
			comparison: null,
			modelSummaries: [],
			previousModelSummaries: [],
			results: [
				{ testPath: 'revenue.yml', testName: 'revenue', passed: true, message: 'match', errorMessage: null },
				{
					testPath: 'churn.yml',
					testName: 'churn',
					passed: false,
					message: 'values differ',
					errorMessage: null,
				},
			],
		});
		renderPanel();

		expect(await screen.findByRole('button', { name: /^Passed\s*revenue/ })).toBeTruthy();
		expect(screen.getByRole('button', { name: /^Failed\s*churn.*values differ/ })).toBeTruthy();
		expect(filterLabels()).toEqual(['All2', 'Passed1', 'Failed1']);

		fireEvent.click(screen.getByRole('radio', { name: /Failed/ }));

		expect(screen.queryByText('revenue')).toBeNull();
		expect(screen.getByText('churn')).toBeTruthy();
	});

	it('ranks the models of a run and shows each test against each model', async () => {
		mocks.getRun.mockResolvedValue(
			multiModelRun([
				['revenue.yml', 'claude-sonnet-5', true],
				['revenue.yml', 'claude-haiku-5', true],
				['churn.yml', 'claude-sonnet-5', true],
				['churn.yml', 'claude-haiku-5', false],
			]),
		);
		renderPanel();

		const leaderboard = (await screen.findAllByRole('table'))[0];
		const rows = within(leaderboard).getAllByRole('row') as HTMLTableRowElement[];
		expect(rows.map((row) => row.cells[0].textContent)).toEqual([
			'Model',
			'claude-sonnet-5Most accurate',
			'claude-haiku-5Best value',
		]);
		expect(filterLabels()).toEqual(['All2', 'Passed1', 'Failed1', 'Models disagree1']);

		fireEvent.click(screen.getByRole('radio', { name: /Models disagree/ }));

		const matrix = screen.getAllByRole('table')[1];
		expect(
			within(matrix)
				.getAllByRole('button')
				.map((button) => button.textContent),
		).toEqual(['churn']);
	});

	it('shows how a single model moved since its previous run', async () => {
		mocks.getRun.mockResolvedValue({
			...multiModelRun([['revenue.yml', 'claude-sonnet-5', true]]),
			models: [{ provider: 'anthropic', modelId: 'claude-sonnet-5' }],
			modelSummaries: [summary('claude-sonnet-5', 1, 1, 0.04)],
			previousModelSummaries: [
				{
					runId: 'run-0',
					runCreatedAt: new Date().toISOString(),
					summary: summary('claude-sonnet-5', 0, 1, 0.05),
				},
			],
		});
		renderPanel();

		const stats = await screen.findAllByRole('term');
		expect(stats.map((stat) => stat.parentElement?.textContent).slice(0, 2)).toEqual([
			'Passed1/1▲ 1',
			'$ / question$0.040▼ 20%',
		]);
	});

	it('narrows the tests to a tag and picks them for the next run', async () => {
		mocks.listTests.mockResolvedValue({
			tests: [testDefinition('revenue.yml', ['finance']), testDefinition('churn.yml', ['product'])],
			invalidFiles: [],
			latestOutcomes: {},
			settings: { errors: [] },
		});
		const onSelectedPathsChange = vi.fn();
		const onSelectedTagsChange = vi.fn();
		renderPanel({ selectedRunId: null, selectedTags: ['finance'], onSelectedPathsChange, onSelectedTagsChange });

		expect(await screen.findByText('revenue.yml')).toBeTruthy();
		expect(screen.queryByText('churn.yml')).toBeNull();

		fireEvent.click(screen.getByRole('checkbox', { name: 'Select the shown tests' }));
		expect(onSelectedPathsChange).toHaveBeenLastCalledWith(new Set(['revenue.yml']));

		fireEvent.click(screen.getByRole('button', { name: 'product' }));
		expect(onSelectedTagsChange).toHaveBeenLastCalledWith(['finance', 'product']);
	});
});

function multiModelRun(results: [testPath: string, modelId: string, passed: boolean][]) {
	const modelIds = [...new Set(results.map(([, modelId]) => modelId))];
	return {
		id: 'run-1',
		status: 'completed',
		trigger: 'manual',
		models: modelIds.map((modelId) => ({ provider: 'anthropic', modelId })),
		attempts: 1,
		completedAttempts: results.length,
		totalAttempts: results.length,
		errorMessage: null,
		comparison: null,
		modelSummaries: modelIds.map((modelId) => {
			const modelResults = results.filter(([, resultModelId]) => resultModelId === modelId);
			const passed = modelResults.filter(([, , isPassed]) => isPassed).length;
			return summary(modelId, passed, modelResults.length, modelId === 'claude-haiku-5' ? 0.01 : 0.04);
		}),
		previousModelSummaries: [],
		results: results.map(([testPath, modelId, passed], index) => ({
			id: `result-${index}`,
			testPath,
			testName: testPath.replace('.yml', ''),
			llmProvider: 'anthropic',
			llmModelId: modelId,
			contextVariant: 'production',
			attempt: 1,
			passed,
			message: passed ? 'match' : 'values differ',
			errorMessage: null,
			totalCost: null,
			toolCallCount: null,
			durationMs: null,
		})),
	};
}

function summary(modelId: string, passedAttempts: number, attempts: number, costPerQuestion: number) {
	return {
		provider: 'anthropic',
		modelId,
		contextVariant: 'production',
		attempts,
		passedAttempts,
		testCount: attempts,
		reliableTestCount: passedAttempts,
		totalCost: costPerQuestion * attempts,
		costPerQuestion,
		costPerCorrectAnswer: passedAttempts ? (costPerQuestion * attempts) / passedAttempts : null,
		averageToolCalls: 5,
		medianDurationMs: 10_000,
		averageTokens: 20_000,
	};
}

function testDefinition(path: string, tags: string[]) {
	return {
		path,
		name: path,
		prompt: 'prompt',
		sql: null,
		databaseId: null,
		assertions: [],
		tags,
		owner: null,
		hash: path,
	};
}

function filterLabels() {
	const filters = screen.getByRole('radiogroup', { name: 'Filter the tests' });
	return within(filters)
		.getAllByRole('radio')
		.map((radio) => radio.textContent);
}

function renderPanel({
	selectedRunId = 'run-1',
	selectedTags = [],
	onSelectedPathsChange = vi.fn(),
	onSelectedTagsChange = vi.fn(),
}: {
	selectedRunId?: string | null;
	selectedTags?: string[];
	onSelectedPathsChange?: (paths: Set<string>) => void;
	onSelectedTagsChange?: (tags: string[]) => void;
} = {}) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<TestSuitePanel
					draft={null}
					runs={[]}
					selectedRunId={selectedRunId}
					selection={{ selectedPaths: new Set(), onSelectedPathsChange, selectedTags, onSelectedTagsChange }}
					onSelectRun={vi.fn()}
					onOpenTest={vi.fn()}
				/>
			</TooltipProvider>
		</QueryClientProvider>,
	);
}
