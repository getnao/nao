// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TestWorkbench } from './test-workbench';
import type { DraftContext, TestHistoryRun, TestRunResult } from './test-run-types';
import { TooltipProvider } from '@/components/ui/tooltip';

const mocks = vi.hoisted(() => ({
	getTestHistory: vi.fn(),
	validateTestFile: vi.fn(),
	startDraftRun: vi.fn(),
	startComparisonRun: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
	Link: ({ children }: { children: React.ReactNode }) => <a href='/settings/tests'>{children}</a>,
}));

vi.mock('@/hooks/use-debounced-value', () => ({ useDebouncedValue: (value: unknown) => value }));

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
			validateTestFile: { mutationOptions: mutationOptions(mocks.validateTestFile) },
			startDraftRun: { mutationOptions: mutationOptions(mocks.startDraftRun) },
			startComparisonRun: { mutationOptions: mutationOptions(mocks.startComparisonRun) },
		},
	},
}));

const TEST_FILE = { path: '/tests/revenue.yml', content: 'name: revenue\nprompt: What is the revenue?' };

describe('TestWorkbench', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.validateTestFile.mockResolvedValue({ test: testDefinition('hash-1'), error: null });
		mocks.getTestHistory.mockResolvedValue([]);
		mocks.startDraftRun.mockResolvedValue({ id: 'run-new' });
		mocks.startComparisonRun.mockResolvedValue({ id: 'run-new' });
	});

	afterEach(cleanup);

	it('runs the test as it is in the editor when the context has no other change', async () => {
		renderWorkbench(draftWith(['tests/revenue.yml']));

		const runButton = await screen.findByRole('button', { name: 'Run test' });
		await waitFor(() => expect(runButton.hasAttribute('disabled')).toBe(false));
		fireEvent.click(runButton);

		await waitFor(() => expect(mocks.startDraftRun).toHaveBeenCalled());
		expect(mocks.startDraftRun.mock.calls[0][0]).toEqual(TEST_FILE);
		expect(screen.queryByRole('button', { name: 'Compare with production' })).toBeNull();
	});

	it('compares the edited test with production when the context changed', async () => {
		renderWorkbench(draftWith(['RULES.md']));

		const compareButton = await screen.findByRole('button', { name: 'Compare with production' });
		await waitFor(() => expect(compareButton.hasAttribute('disabled')).toBe(false));
		fireEvent.click(compareButton);

		await waitFor(() => expect(mocks.startComparisonRun).toHaveBeenCalled());
		expect(mocks.startComparisonRun.mock.calls[0][0]).toEqual({ testFile: TEST_FILE });
		expect(screen.getByRole('button', { name: 'Run on production' })).toBeTruthy();
	});

	it('does not run an invalid test', async () => {
		mocks.validateTestFile.mockResolvedValue({ test: null, error: 'prompt is required' });
		renderWorkbench(null);

		await screen.findByText('Invalid test: prompt is required');
		expect(screen.getByRole('button', { name: 'Run test' }).hasAttribute('disabled')).toBe(true);
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

	it('flags runs of an older version of the test', async () => {
		mocks.getTestHistory.mockResolvedValue([
			{
				...comparisonRun([result({ id: 'production-1', contextVariant: 'production', passed: true })]),
				trigger: 'draft',
				comparison: null,
			},
		]);
		mocks.validateTestFile.mockResolvedValue({ test: testDefinition('hash-2'), error: null });
		renderWorkbench(null);

		expect(await screen.findByText('Ran an older version of this test')).toBeTruthy();
	});
});

function renderWorkbench(draft: DraftContext | null) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<TestWorkbench testFile={TEST_FILE} draft={draft} isRunInProgress={false} onRunStarted={vi.fn()} />
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
}: {
	id: string;
	contextVariant: 'production' | 'draft';
	passed: boolean;
	actualTotal?: number;
}): TestRunResult {
	return {
		id,
		runId: 'run-1',
		testPath: 'revenue.yml',
		testName: 'revenue',
		testHash: 'hash-1',
		llmProvider: 'openai',
		llmModelId: 'gpt-4.1',
		contextVariant,
		attempt: 1,
		passed,
		message: passed ? 'match' : 'values differ',
		errorMessage: null,
		chatId: null,
		durationMs: 1200,
		totalCost: null,
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

function mutationOptions(mutationFn: (input: unknown) => Promise<unknown>) {
	return (options: object) => ({ mutationFn, ...options });
}
