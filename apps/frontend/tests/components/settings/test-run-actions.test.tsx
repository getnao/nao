// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '../../helpers/query-client';
import { openDropdownMenu } from '../../helpers/dropdown-menu';
import type { ReactNode } from 'react';

import type { DraftContext, TestRunSummary } from '@/components/settings/test-run-types';
import type { TestFileValidationState } from '@/hooks/use-test-file-validation';
import type { TestRunSettings } from '@/hooks/use-test-run-settings';
import { SuiteRunActions, TestFileRunActions } from '@/components/settings/test-run-actions';
import { TooltipProvider } from '@/components/ui/tooltip';
import { isMac } from '@/lib/platform';

const mocks = vi.hoisted(() => ({
	startRun: vi.fn(),
	cancelRun: vi.fn(),
	listUpstreamRepos: vi.fn(),
	listUpstreamBranches: vi.fn(),
}));

vi.mock('@/main', () => ({
	trpc: {
		project: {
			listAvailableTranscribeModels: { queryOptions: () => ({ queryKey: ['models'], queryFn: () => [] }) },
		},
		testRun: {
			getModelStats: { queryOptions: () => ({ queryKey: ['model-stats'], queryFn: () => [] }) },
			getDefaultReasoningEfforts: {
				queryOptions: () => ({ queryKey: ['default-reasoning-efforts'], queryFn: () => [] }),
			},
			listRuns: { queryKey: () => ['test-runs'] },
			listUpstreamRepos: {
				queryOptions: () => ({ queryKey: ['upstream-repos'], queryFn: mocks.listUpstreamRepos }),
			},
			listUpstreamBranches: {
				queryOptions: (input: { repo: string }) => ({
					queryKey: ['upstream-branches', input.repo],
					queryFn: () => mocks.listUpstreamBranches(input),
				}),
			},
			startRun: { mutationOptions: mutationOptions(mocks.startRun) },
			cancelRun: { mutationOptions: mutationOptions(mocks.cancelRun) },
		},
	},
}));

const TEST_FILE = { path: '/tests/revenue.yml', content: 'name: revenue\nprompt: What is the revenue?' };
const MODELS = [
	{ provider: 'anthropic', modelId: 'claude-sonnet-5' },
	{ provider: 'anthropic', modelId: 'claude-haiku-5' },
] as TestRunSettings['models'];
const VALID: TestFileValidationState = {
	validation: { test: {}, error: null },
	error: undefined,
} as TestFileValidationState;

describe('TestFileRunActions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.startRun.mockResolvedValue({ id: 'run-new' });
		mocks.listUpstreamRepos.mockResolvedValue([]);
	});

	afterEach(() => {
		cleanup();
		localStorage.clear();
	});

	it('runs the test as it is in the editor, with the picked models and attempts', async () => {
		const onRunStarted = vi.fn();
		renderWithProviders(
			<TestFileRunActions
				settings={settings()}
				draft={draftWith(['tests/revenue.yml'])}
				activeRun={undefined}
				testFile={TEST_FILE}
				validation={VALID}
				onRunStarted={onRunStarted}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Run test' }));

		await waitFor(() => expect(onRunStarted.mock.calls[0]?.[0]).toEqual({ id: 'run-new' }));
		expect(mocks.startRun.mock.calls[0][0]).toEqual({
			mode: 'production',
			target: { testFile: TEST_FILE },
			models: MODELS,
			attempts: 3,
			threads: 6,
		});
		expect(screen.getByRole('button', { name: 'Models to test' }).textContent).toBe('2 models · ×3');
	});

	it('compares the edited test with the default branch when the context changed', async () => {
		renderWithProviders(
			<TestFileRunActions
				settings={settings()}
				draft={draftWith(['RULES.md'])}
				activeRun={undefined}
				testFile={TEST_FILE}
				validation={VALID}
				onRunStarted={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Compare with release' }));

		await waitFor(() => expect(mocks.startRun).toHaveBeenCalled());
		expect(mocks.startRun.mock.calls[0][0]).toEqual({
			mode: 'compare',
			target: { testFile: TEST_FILE },
			models: MODELS,
			attempts: 3,
			threads: 6,
		});
		expect(screen.getByRole('button', { name: 'More ways to run' })).toBeTruthy();
	});

	it('estimates both contexts only when the run compares them', async () => {
		renderWithProviders(
			<TestFileRunActions
				settings={settings()}
				draft={draftWith(['RULES.md'])}
				activeRun={undefined}
				testFile={TEST_FILE}
				validation={VALID}
				onRunStarted={vi.fn()}
			/>,
		);

		openDropdownMenu(screen.getByRole('button', { name: 'More ways to run' }));
		fireEvent.click(await screen.findByRole('menuitem', { name: 'Run with your changes only' }));
		fireEvent.click(screen.getByRole('button', { name: 'Models to test' }));

		expect(await screen.findByText('6 answers')).toBeTruthy();
		expect(screen.queryByText(/2 contexts/)).toBeNull();
	});

	it('makes the picked way to run the button action for the next click', async () => {
		renderWithProviders(
			<TestFileRunActions
				settings={settings()}
				draft={draftWith(['RULES.md'])}
				activeRun={undefined}
				testFile={TEST_FILE}
				validation={VALID}
				onRunStarted={vi.fn()}
			/>,
		);

		openDropdownMenu(screen.getByRole('button', { name: 'More ways to run' }));
		fireEvent.click(await screen.findByRole('menuitem', { name: 'Run with your changes only' }));
		expect(mocks.startRun).not.toHaveBeenCalled();

		fireEvent.click(await screen.findByRole('button', { name: 'Run with your changes' }));

		await waitFor(() => expect(mocks.startRun).toHaveBeenCalledTimes(1));
		expect(mocks.startRun.mock.calls[0][0]).toEqual({
			mode: 'changes',
			target: { testFile: TEST_FILE },
			models: MODELS,
			attempts: 3,
			threads: 6,
		});
	});

	it('starts the button action with the run shortcut, from anywhere on the page', async () => {
		renderWithProviders(
			<TestFileRunActions
				settings={settings()}
				draft={draftWith(['RULES.md'])}
				activeRun={undefined}
				testFile={TEST_FILE}
				validation={VALID}
				onRunStarted={vi.fn()}
			/>,
		);

		pressRunShortcut();

		await waitFor(() => expect(mocks.startRun).toHaveBeenCalled());
		expect(mocks.startRun.mock.calls[0][0]).toMatchObject({ mode: 'compare' });
	});

	it('does not run an invalid test', () => {
		renderWithProviders(
			<TestFileRunActions
				settings={settings()}
				draft={null}
				activeRun={undefined}
				testFile={TEST_FILE}
				validation={{ validation: { test: null, error: 'prompt is required' }, error: undefined }}
				onRunStarted={vi.fn()}
			/>,
		);

		expect(screen.getByRole('button', { name: 'Run test' }).hasAttribute('disabled')).toBe(true);

		pressRunShortcut();
		expect(mocks.startRun).not.toHaveBeenCalled();
	});

	it('offers to cancel the run in progress instead of starting another', async () => {
		mocks.cancelRun.mockResolvedValue({ cancelled: true });
		renderWithProviders(
			<TestFileRunActions
				settings={settings()}
				draft={null}
				activeRun={{ id: 'run-1', status: 'running' } as TestRunSummary}
				testFile={TEST_FILE}
				validation={VALID}
				onRunStarted={vi.fn()}
			/>,
		);

		expect(screen.queryByRole('button', { name: 'Run test' })).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
		await waitFor(() => expect(mocks.cancelRun.mock.calls[0][0]).toEqual({ runId: 'run-1' }));
	});
});

describe('SuiteRunActions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.startRun.mockResolvedValue({ id: 'run-new' });
		mocks.listUpstreamRepos.mockResolvedValue([]);
	});

	afterEach(() => {
		cleanup();
		localStorage.clear();
	});

	it('compares the tests with a branch of a synced repository picked in the menu', async () => {
		mocks.listUpstreamRepos.mockResolvedValue([
			{ name: 'business', url: 'https://github.com/acme/business', branch: 'main' },
		]);
		mocks.listUpstreamBranches.mockResolvedValue([
			{ name: 'main', commit: 'abc' },
			{ name: 'analyst/net-revenue', commit: 'def' },
		]);
		renderWithProviders(
			<SuiteRunActions
				settings={settings()}
				draft={null}
				activeRun={undefined}
				scope={{ paths: undefined, testCount: 6, label: '6 tests' }}
				onRunStarted={vi.fn()}
			/>,
		);

		openDropdownMenu(await screen.findByRole('button', { name: 'Changes to test against production' }));
		fireEvent.click(await screen.findByRole('menuitem', { name: 'analyst/net-revenue' }));
		fireEvent.click(await screen.findByRole('button', { name: 'Compare 6 tests with main' }));

		await waitFor(() => expect(mocks.startRun).toHaveBeenCalled());
		expect(mocks.listUpstreamBranches).toHaveBeenCalledWith({ repo: 'business' });
		expect(mocks.startRun.mock.calls[0][0]).toEqual({
			mode: 'compare',
			target: { paths: undefined },
			models: MODELS,
			attempts: 3,
			threads: 6,
			upstream: { repo: 'business', branch: 'analyst/net-revenue' },
		});
	});

	it('waits for the synced repositories before running a saved branch', async () => {
		localStorage.setItem('nao-test-upstream-source', JSON.stringify({ repo: 'business', branch: 'analyst/x' }));
		mocks.listUpstreamRepos.mockReturnValue(new Promise(() => {}));
		renderWithProviders(
			<SuiteRunActions
				settings={settings({ models: MODELS.slice(0, 1), attempts: 1 })}
				draft={null}
				activeRun={undefined}
				scope={{ paths: undefined, testCount: 6, label: '6 tests' }}
				onRunStarted={vi.fn()}
			/>,
		);

		const runButton = await screen.findByRole('button', { name: /6 tests/ });
		expect(runButton.hasAttribute('disabled')).toBe(true);
		pressRunShortcut();
		expect(mocks.startRun).not.toHaveBeenCalled();
	});

	it('ignores a branch picked in a repository this project does not sync', async () => {
		localStorage.setItem('nao-test-upstream-source', JSON.stringify({ repo: 'gone', branch: 'analyst/old' }));
		renderWithProviders(
			<SuiteRunActions
				settings={settings({ models: MODELS.slice(0, 1), attempts: 1 })}
				draft={null}
				activeRun={undefined}
				scope={{ paths: undefined, testCount: 6, label: '6 tests' }}
				onRunStarted={vi.fn()}
			/>,
		);

		fireEvent.click(await screen.findByRole('button', { name: 'Run 6 tests' }));

		await waitFor(() => expect(mocks.startRun).toHaveBeenCalled());
		expect(mocks.startRun.mock.calls[0][0]).toMatchObject({ mode: 'production', upstream: undefined });
	});

	it('benchmarks the picked tests on every picked model', async () => {
		renderWithProviders(
			<SuiteRunActions
				settings={settings()}
				draft={null}
				activeRun={undefined}
				scope={{ paths: ['revenue.yml', 'churn.yml'], testCount: 2, label: '2 selected' }}
				onRunStarted={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Benchmark 2 selected' }));

		await waitFor(() => expect(mocks.startRun).toHaveBeenCalled());
		expect(mocks.startRun.mock.calls[0][0]).toEqual({
			mode: 'production',
			target: { paths: ['revenue.yml', 'churn.yml'] },
			models: MODELS,
			attempts: 3,
			threads: 6,
		});
	});

	it('runs the whole suite on one model', () => {
		renderWithProviders(
			<SuiteRunActions
				settings={settings({ models: MODELS.slice(0, 1), attempts: 1 })}
				draft={null}
				activeRun={undefined}
				scope={{ paths: undefined, testCount: 6, label: '6 tests' }}
				onRunStarted={vi.fn()}
			/>,
		);

		expect(screen.getByRole('button', { name: 'Run 6 tests' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Models to test' }).textContent).toBe('claude-sonnet-5');
	});
});

function settings(overrides: Partial<TestRunSettings> = {}): TestRunSettings {
	return {
		models: MODELS,
		attempts: 3,
		threads: 6,
		isCustom: true,
		isLoading: false,
		update: vi.fn(),
		reset: vi.fn(),
		...overrides,
	};
}

function draftWith(paths: string[]): DraftContext {
	return {
		status: 'available',
		storage: 'git',
		branch: 'improve-revenue',
		productionBranch: 'release',
		changes: paths.map((path) => ({ path, kind: 'modified' as const })),
		excludedChanges: [],
		outdatedPaths: [],
	} as unknown as DraftContext;
}

function renderWithProviders(children: ReactNode) {
	const queryClient = createTestQueryClient();
	return render(
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>{children}</TooltipProvider>
		</QueryClientProvider>,
	);
}

function pressRunShortcut() {
	fireEvent.keyDown(document, { key: 'e', ctrlKey: !isMac, metaKey: isMac });
}

function mutationOptions(mutationFn: (input: unknown) => Promise<unknown>) {
	return (options: object) => ({ mutationFn, ...options });
}
