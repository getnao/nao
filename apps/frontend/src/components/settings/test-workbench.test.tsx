// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TestWorkbench } from './test-workbench';
import type { DraftContext, TestHistoryRun, TestRunResult } from './test-run-types';
import type { TestFileValidationState } from '@/hooks/use-test-file-validation';
import { TooltipProvider } from '@/components/ui/tooltip';

const mocks = vi.hoisted(() => ({ getTestHistory: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
	Link: ({ children }: { children: React.ReactNode }) => <a href='/settings/usage'>{children}</a>,
}));

vi.mock('@/main', () => ({
	trpc: {
		testRun: {
			getTestHistory: {
				queryOptions: (input: { path: string }) => ({
					queryKey: ['test-history', input.path],
					queryFn: mocks.getTestHistory,
				}),
				queryKey: (input: { path: string }) => ['test-history', input.path],
			},
		},
	},
}));

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

	it('says in words what the latest comparison found and shows the data of each side', async () => {
		mocks.getTestHistory.mockResolvedValue([
			comparisonRun([
				result({ id: 'production-1', contextVariant: 'production', passed: true, actualTotal: 100 }),
				result({ id: 'draft-1', contextVariant: 'draft', passed: false, actualTotal: 90 }),
			]),
		]);
		renderWorkbench(draftWith(['RULES.md']));

		expect(await screen.findAllByText('Broken by your changes')).toHaveLength(2);
		expect(screen.getByText('90')).toBeTruthy();
		expect(screen.getByText('1 different')).toBeTruthy();

		fireEvent.click(screen.getByRole('radio', { name: /Production/ }));

		expect(screen.getByText('100')).toBeTruthy();
		expect(screen.getByText('1 matching')).toBeTruthy();
	});

	it('stops showing the variants as loading once the run is cancelled', async () => {
		mocks.getTestHistory.mockResolvedValue([
			{
				...comparisonRun([]),
				status: 'cancelled',
				comparison: {
					testPath: 'revenue.yml',
					testName: 'revenue',
					production: { passed: 0, total: 0 },
					draft: { passed: 0, total: 0 },
					change: 'pending',
				},
			},
		]);
		renderWorkbench(draftWith(['RULES.md']));

		expect(await screen.findAllByText('Run cancelled')).toHaveLength(2);
		expect(screen.getByRole('radio', { name: /Production/ })).toBeTruthy();
		expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
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
	});
});

function renderWorkbench(
	draft: DraftContext | null,
	{
		selectedRunId = null,
		onSelectRun = vi.fn(),
		validation = { validation: { test: testDefinition('hash-1'), error: null }, error: undefined },
	}: {
		selectedRunId?: string | null;
		onSelectRun?: () => void;
		validation?: TestFileValidationState;
	} = {},
) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<TestWorkbench
					testFile={TEST_FILE}
					validation={validation}
					draft={draft}
					selectedRunId={selectedRunId}
					onSelectRun={onSelectRun}
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
		createdAt: new Date().toISOString(),
		models: [{ provider: 'openai', modelId: 'gpt-4.1' }],
		attempts: 1,
		attemptsPerVariant: 1,
		completedAttempts: results.length,
		totalAttempts: results.length,
		errorMessage: null,
		results,
		comparison: {
			testPath: 'revenue.yml',
			testName: 'revenue',
			production: { passed: production.filter((entry) => entry.passed).length, total: production.length },
			draft: { passed: draft.filter((entry) => entry.passed).length, total: draft.length },
			change: 'regressed',
		},
	} as unknown as TestHistoryRun;
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
			comparison: null,
			referenceSql: 'select 100 as total',
			verificationSql: 'select sum(amount) as total from orders',
		},
		dataDiff: {
			columns: ['total'],
			missingColumns: [],
			extraColumns: [],
			expectedRowCount: 1,
			actualRowCount: 1,
			isTruncated: false,
			rows: [
				{
					expected: [100],
					actual: [actualTotal],
					statuses: [actualTotal === 100 ? 'match' : 'differ'],
				},
			],
		},
	} as unknown as TestRunResult;
}
