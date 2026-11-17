// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestQueryClient } from '../../helpers/query-client';
import type { DraftContext, TestDataDiff, TestHistoryRun, TestRunResult } from '@/components/settings/test-run-types';
import type { TestFileValidationState } from '@/hooks/use-test-file-validation';
import type { TestRunSettings } from '@/hooks/use-test-run-settings';
import { TestWorkbench } from '@/components/settings/test-workbench';
import { TooltipProvider } from '@/components/ui/tooltip';

const mocks = vi.hoisted(() => ({ getTestHistory: vi.fn(), startRun: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
	Link: ({ children }: { children: React.ReactNode }) => <a href='/settings/usage'>{children}</a>,
}));

vi.mock('@/main', () => ({
	trpc: {
		testRun: {
			listUpstreamRepos: { queryOptions: () => ({ queryKey: ['upstream-repos'], queryFn: () => [] }) },
			getTestHistory: {
				queryOptions: (input: { path: string; runId?: string }) => ({
					queryKey: ['test-history', input.path, input.runId],
					queryFn: () => mocks.getTestHistory(input),
				}),
				queryKey: (input: { path: string }) => ['test-history', input.path],
			},
			startRun: { mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.startRun }) },
		},
	},
}));

const RUN_SETTINGS = {
	models: [{ provider: 'openai', modelId: 'gpt-4.1' }],
	attempts: 1,
	isCustom: false,
	isLoading: false,
	update: vi.fn(),
	reset: vi.fn(),
} as unknown as TestRunSettings;

const TEST_FILE = { path: '/tests/revenue.yml', content: 'name: revenue\nprompt: What is the revenue?' };

describe('TestWorkbench', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getTestHistory.mockResolvedValue([]);
	});

	afterEach(cleanup);

	it('opens the runs picked in the list, so the drawer can go back to them', async () => {
		mocks.getTestHistory.mockResolvedValue([
			{ ...comparisonRun([result({ id: 'draft-2', contextVariant: 'draft', passed: true })]), id: 'run-2' },
			comparisonRun([result({ id: 'draft-1', contextVariant: 'draft', passed: false })]),
		]);
		const onSelectRun = vi.fn();
		renderWorkbench(draftWith(['tests/revenue.yml']), { selectedRunId: 'run-1', onSelectRun });

		const runs = await screen.findAllByRole('option');
		expect(runs.map((run) => run.getAttribute('aria-selected'))).toEqual(['false', 'true']);
		fireEvent.click(runs[0]);
		expect(onSelectRun).toHaveBeenLastCalledWith('run-2');
	});

	it('fetches an older run opened from a run of several tests, and opens that whole run', async () => {
		const latestRun = {
			...comparisonRun([result({ id: 'draft-2', contextVariant: 'draft', passed: true })]),
			id: 'run-2',
		};
		const olderRun = {
			...comparisonRun([result({ id: 'production-1', contextVariant: 'production', passed: true })]),
			id: 'run-old',
			trigger: 'manual',
			selection: ['revenue.yml', 'churn.yml'],
			comparison: null,
		};
		mocks.getTestHistory.mockImplementation(async (input: { runId?: string }) =>
			input.runId === 'run-old' ? [latestRun, olderRun] : [latestRun],
		);
		const onOpenSuiteRun = vi.fn();
		renderWorkbench(null, { selectedRunId: 'run-old', onOpenSuiteRun });

		await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
		expect(screen.getAllByRole('option').map((run) => run.getAttribute('aria-selected'))).toEqual([
			'false',
			'true',
		]);

		fireEvent.click(screen.getByRole('button', { name: 'All 2 tests of the run' }));
		expect(onOpenSuiteRun).toHaveBeenLastCalledWith('run-old');
	});

	it('says why an invalid test cannot run', async () => {
		renderWorkbench(null, {
			validation: { validation: { test: null, error: 'prompt is required' }, error: undefined },
		});

		expect(await screen.findByText('Invalid test: prompt is required')).toBeTruthy();
	});

	it('shows each model of a run with its attempts, and the attempts of the model picked', async () => {
		mocks.getTestHistory.mockResolvedValue([
			{
				...comparisonRun([
					result({ id: 'gpt-1', contextVariant: 'production', passed: true }),
					result({ id: 'haiku-1', contextVariant: 'production', passed: false, modelId: 'claude-haiku-5' }),
				]),
				trigger: 'manual',
				comparison: null,
				models: [
					{ provider: 'openai', modelId: 'gpt-4.1' },
					{ provider: 'anthropic', modelId: 'claude-haiku-5' },
				],
			},
		]);
		renderWorkbench(null);

		const models = await screen.findByRole('radiogroup', { name: 'Model' });
		const [gpt, haiku] = within(models).getAllByRole('radio');
		expect(haiku.getAttribute('aria-checked')).toBe('true');
		expect(screen.getByText(/claude-haiku-5 · 1\.2s/)).toBeTruthy();

		fireEvent.click(gpt);

		expect(screen.getByText(/gpt-4\.1 · 1\.2s/)).toBeTruthy();
	});

	it('says in words what the latest comparison found and diffs the data of both branches', async () => {
		mocks.getTestHistory.mockResolvedValue([
			comparisonRun([
				result({ id: 'production-1', contextVariant: 'production', passed: true, actualTotal: 100 }),
				{
					...result({ id: 'draft-1', contextVariant: 'draft', passed: false, actualTotal: 90 }),
					variantDiff: totalDiff(100, 90),
				},
			]),
		]);
		renderWorkbench(draftWith(['RULES.md']));

		expect(await screen.findByText('Broken by your changes')).toBeTruthy();
		expect(within(screen.getByRole('option')).getByText('regressed')).toBeTruthy();
		expect(screen.queryByRole('radiogroup', { name: 'Context' })).toBeNull();
		expect(screen.getByTitle('Changed: main struck out, then improve-revenue')).toBeTruthy();
		expect(screen.getByText('100').closest('td')?.textContent).toBe('10090');
	});

	it('invites to compare a test that never ran with the main branch', async () => {
		mocks.startRun.mockResolvedValue({ id: 'run-new' });
		const onRunStarted = vi.fn();
		renderWorkbench(draftWith(['RULES.md']), { onRunStarted });

		const compare = await screen.findByRole('button', { name: 'Compare with main' });
		fireEvent.click(compare);

		await vi.waitFor(() => expect(onRunStarted).toHaveBeenCalled());
		expect(mocks.startRun.mock.calls[0][0]).toMatchObject({
			mode: 'compare',
			target: { testFile: TEST_FILE },
			attempts: 1,
		});
	});

	it('says no model is configured once the models loaded without any', async () => {
		renderWorkbench(null, { runSettings: { ...RUN_SETTINGS, models: [] } });
		const run = await screen.findByRole('button', { name: 'Run test' });
		expect(run.hasAttribute('disabled')).toBe(true);
		expect(run.getAttribute('title')).toBe('No model is configured for tests.');
	});

	it('stops showing the variants as loading once the run is cancelled', async () => {
		mocks.getTestHistory.mockResolvedValue([
			{
				...comparisonRun([]),
				status: 'cancelled',
				comparison: {
					testPath: 'revenue.yml',
					testName: 'revenue',
					production: { passedAttempts: 0, totalAttempts: 0 },
					draft: { passedAttempts: 0, totalAttempts: 0 },
					change: 'pending',
				},
			},
		]);
		renderWorkbench(draftWith(['RULES.md']));

		expect(await screen.findByText('Run cancelled')).toBeTruthy();
		expect(screen.getByRole('option').textContent).toBe('revenuevsmain');
		expect(screen.getAllByText('improve-revenue').length).toBeGreaterThan(0);
		expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
	});

	it('names each run after the test, as it judges only this test even when the run covered the whole suite', async () => {
		mocks.getTestHistory.mockResolvedValue([
			{
				...comparisonRun([result({ id: 'production-1', contextVariant: 'production', passed: true })]),
				trigger: 'manual',
				selection: ['revenue.yml', 'churn.yml'],
				comparison: null,
			},
		]);
		renderWorkbench(null);

		expect((await screen.findByRole('option')).textContent).toBe('revenuemain');
	});

	it('flags runs of an older version of the test', async () => {
		mocks.getTestHistory.mockResolvedValue([
			{
				...comparisonRun([result({ id: 'production-1', contextVariant: 'production', passed: true })]),
				trigger: 'draft',
				comparison: null,
			},
		]);
		renderWorkbench(null, {
			validation: { validation: { test: testDefinition('hash-2'), error: null }, error: undefined },
		});

		expect(await screen.findByText('Ran an older version of this test')).toBeTruthy();
		expect(within(screen.getByRole('option')).getByText('older version')).toBeTruthy();
	});
});

function renderWorkbench(
	draft: DraftContext | null,
	{
		selectedRunId = null,
		onSelectRun = vi.fn(),
		onOpenSuiteRun = vi.fn(),
		onRunStarted = vi.fn(),
		validation = { validation: { test: testDefinition('hash-1'), error: null }, error: undefined },
		runSettings = RUN_SETTINGS,
	}: {
		selectedRunId?: string | null;
		onSelectRun?: () => void;
		onOpenSuiteRun?: (runId: string) => void;
		onRunStarted?: () => void;
		validation?: TestFileValidationState;
		runSettings?: TestRunSettings;
	} = {},
) {
	const queryClient = createTestQueryClient();
	return render(
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<TestWorkbench
					testFile={TEST_FILE}
					validation={validation}
					draft={draft}
					selectedRunId={selectedRunId}
					onSelectRun={onSelectRun}
					onOpenSuiteRun={onOpenSuiteRun}
					runSettings={runSettings}
					activeRun={undefined}
					onRunStarted={onRunStarted}
				/>
			</TooltipProvider>
		</QueryClientProvider>,
	);
}

function draftWith(paths: string[]): DraftContext {
	return {
		status: 'available',
		storage: 'git',
		branch: 'improve-revenue',
		changes: paths.map((path) => ({ path, kind: 'modified' as const })),
		excludedChanges: [],
		outdatedPaths: [],
	} as unknown as DraftContext;
}

function testDefinition(hash: string) {
	return {
		path: 'revenue.yml',
		name: 'revenue',
		prompt: 'What is the revenue?',
		sql: 'select 100 as total',
		databaseId: null,
		assertions: [],
		tags: [],
		owner: null,
		hash,
	};
}

function comparisonRun(results: TestRunResult[]): TestHistoryRun {
	const production = results.filter((entry) => entry.contextVariant === 'production');
	const draft = results.filter((entry) => entry.contextVariant === 'draft');
	return {
		id: 'run-1',
		projectId: 'project-1',
		trigger: 'comparison',
		status: 'completed',
		selection: ['revenue.yml'],
		createdAt: new Date().toISOString(),
		models: [{ provider: 'openai', modelId: 'gpt-4.1' }],
		attempts: 1,
		attemptsPerVariant: 1,
		completedAttempts: results.length,
		totalAttempts: results.length,
		errorMessage: null,
		results,
		testTotals: ['draft', 'production']
			.map((variant) => results.filter((entry) => entry.contextVariant === variant))
			.filter((variantResults) => variantResults.length > 0)
			.map((variantResults) => ({
				contextVariant: variantResults[0].contextVariant,
				...countTestAttempts(variantResults),
				models: [],
			})),
		comparison: {
			testPath: 'revenue.yml',
			testName: 'revenue',
			production: countAttempts(production),
			draft: countAttempts(draft),
			change: 'regressed',
		},
	} as unknown as TestHistoryRun;
}

function countAttempts(results: TestRunResult[]) {
	return { passedAttempts: results.filter((entry) => entry.passed).length, totalAttempts: results.length };
}

function countTestAttempts(results: TestRunResult[]) {
	const passedAttempts = results.filter((entry) => entry.passed).length;
	return {
		testCount: 1,
		passedTests: passedAttempts === results.length ? 1 : 0,
		flakyTests: passedAttempts > 0 && passedAttempts < results.length ? 1 : 0,
		passedAttempts,
		totalAttempts: results.length,
	};
}

function result({
	id,
	contextVariant,
	passed,
	actualTotal = 100,
	modelId = 'gpt-4.1',
}: {
	id: string;
	contextVariant: 'production' | 'draft';
	passed: boolean;
	actualTotal?: number;
	modelId?: string;
}): TestRunResult {
	return {
		id,
		runId: 'run-1',
		testPath: 'revenue.yml',
		testName: 'revenue',
		testHash: 'hash-1',
		llmProvider: modelId === 'gpt-4.1' ? 'openai' : 'anthropic',
		llmModelId: modelId,
		contextVariant,
		attempt: 1,
		passed,
		message: passed ? 'match' : 'values differ',
		errorMessage: null,
		chatId: null,
		durationMs: 1200,
		totalCost: null,
		totalTokens: null,
		toolCallCount: null,
		details: {
			responseText: 'The revenue is 100.',
			actualData: [{ total: actualTotal }],
			expectedData: [{ total: 100 }],
			actualRowCount: 1,
			expectedRowCount: 1,
			comparison: null,
			referenceSql: 'select 100 as total',
			verificationSql: 'select sum(amount) as total from orders',
			sourceQueries: [],
		},
		dataDiff: totalDiff(100, actualTotal),
		variantDiff: null,
	} as unknown as TestRunResult;
}

function totalDiff(expected: number, actual: number): TestDataDiff {
	return {
		columns: ['total'],
		missingColumns: [],
		extraColumns: [],
		expectedRowCount: 1,
		actualRowCount: 1,
		isTruncated: false,
		rows: [{ expected: [expected], actual: [actual], statuses: [actual === expected ? 'match' : 'differ'] }],
	};
}
