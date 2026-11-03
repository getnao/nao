// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TestDrawerLayout } from './test-drawer';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.stubGlobal(
	'ResizeObserver',
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
);

vi.stubGlobal(
	'CSSStyleSheet',
	class {
		cssRules: string[] = [];
		insertRule(rule: string) {
			this.cssRules.push(rule);
		}
		deleteRule() {
			this.cssRules.pop();
		}
		replaceSync() {}
	},
);

Object.defineProperty(document, 'adoptedStyleSheets', { value: [], writable: true });

const mocks = vi.hoisted(() => ({ listRuns: vi.fn() }));

vi.mock('@/main', () => ({
	trpc: {
		project: {
			getCurrent: { queryOptions: () => ({ queryKey: ['project'], queryFn: () => ({ id: 'project-1' }) }) },
			getDefaultChatModel: {
				queryOptions: () => ({
					queryKey: ['default-model'],
					queryFn: () => ({ provider: 'anthropic', modelId: 'claude-sonnet-5' }),
				}),
			},
			listAvailableTranscribeModels: { queryOptions: () => ({ queryKey: ['models'], queryFn: () => [] }) },
		},
		testRun: {
			getModelStats: { queryOptions: () => ({ queryKey: ['model-stats'], queryFn: () => [] }) },
			startRun: { mutationOptions: (options: object) => ({ mutationFn: vi.fn(), ...options }) },
			startComparisonRun: { mutationOptions: (options: object) => ({ mutationFn: vi.fn(), ...options }) },
			startDraftRun: { mutationOptions: (options: object) => ({ mutationFn: vi.fn(), ...options }) },
			cancelRun: { mutationOptions: (options: object) => ({ mutationFn: vi.fn(), ...options }) },
			validateTestFile: { mutationOptions: (options: object) => ({ mutationFn: vi.fn(), ...options }) },
			listRuns: {
				queryOptions: () => ({ queryKey: ['test-runs'], queryFn: mocks.listRuns }),
				queryKey: () => [],
			},
			getDraftContext: {
				queryOptions: () => ({ queryKey: ['draft-context'], queryFn: () => ({ status: 'unavailable' }) }),
				queryKey: () => ['draft-context'],
			},
			listTests: {
				queryOptions: () => ({
					queryKey: ['tests'],
					queryFn: () => ({
						tests: [{ tags: [] }, { tags: [] }, { tags: [] }],
						settings: { models: null, attempts: 1, errors: [] },
					}),
				}),
				queryKey: () => ['tests'],
			},
			getTestHistory: { queryKey: () => ['test-history'] },
			getRun: { queryKey: () => ['test-run'] },
		},
		contextExplorer: {
			getChangedFiles: { queryOptions: () => ({ queryKey: ['changed-files'], queryFn: () => [] }) },
		},
	},
}));

describe('TestDrawerLayout', () => {
	beforeEach(() => {
		localStorage.clear();
		mocks.listRuns.mockResolvedValue([
			{ id: 'run-1', status: 'running', trigger: 'comparison', completedAttempts: 1, totalAttempts: 4 },
		]);
	});

	afterEach(cleanup);

	it('keeps the editor above a bar with all the tests first, then a tab per opened test', async () => {
		renderDrawer({ testTabs: ['/tests/sales/revenue.yml', '/tests/churn.yml'] });

		expect(screen.getByText('Editor')).toBeTruthy();
		await waitFor(() =>
			expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
				'All tests (3)',
				'revenue.yml',
				'churn.yml',
			]),
		);
		await waitFor(() => expect(screen.getByText('Comparing 1/4')).toBeTruthy());
	});

	it('offers to run the tests from the bar, even while the drawer is collapsed', async () => {
		mocks.listRuns.mockResolvedValue([]);
		renderDrawer({});

		expect(await screen.findByRole('button', { name: 'Run 3 tests' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Models to test' }).textContent).toBe('claude-sonnet-5');
	});

	it('offers to cancel the run in progress from the bar', async () => {
		renderDrawer({});

		expect(await screen.findByRole('button', { name: 'Cancel run' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Run 3 tests' })).toBeNull();
	});

	it('switches to another tab, but not to the one already shown', () => {
		const onSelectTab = vi.fn();
		renderDrawer({
			testTabs: ['/tests/revenue.yml', '/tests/churn.yml'],
			activeTestPath: '/tests/revenue.yml',
			onSelectTab,
		});

		fireEvent.click(screen.getByRole('tab', { name: 'revenue.yml' }));
		expect(onSelectTab).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole('tab', { name: 'churn.yml' }));
		expect(onSelectTab).toHaveBeenLastCalledWith('/tests/churn.yml');

		fireEvent.click(screen.getByRole('tab', { name: /^All tests/ }));
		expect(onSelectTab).toHaveBeenLastCalledWith(null);
	});

	it('closes a test tab with its cross or a middle click, but never all the tests', () => {
		const onCloseTab = vi.fn();
		renderDrawer({ testTabs: ['/tests/revenue.yml', '/tests/churn.yml'], onCloseTab });

		fireEvent.click(screen.getByRole('button', { name: 'Close /tests/revenue.yml' }));
		expect(onCloseTab).toHaveBeenLastCalledWith('/tests/revenue.yml');

		fireEvent(
			screen.getByRole('tab', { name: 'churn.yml' }),
			new MouseEvent('auxclick', { bubbles: true, button: 1 }),
		);
		expect(onCloseTab).toHaveBeenLastCalledWith('/tests/churn.yml');
		expect(screen.queryByRole('button', { name: /Close All tests/ })).toBeNull();
	});
});

function renderDrawer({
	testTabs = [],
	activeTestPath = null,
	onSelectTab = vi.fn(),
	onCloseTab = vi.fn(),
}: {
	testTabs?: string[];
	activeTestPath?: string | null;
	onSelectTab?: (testPath: string | null) => void;
	onCloseTab?: (testPath: string) => void;
}) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<TestDrawerLayout
					testTabs={testTabs}
					activeTestPath={activeTestPath}
					activeTestFile={null}
					selectedRunId={null}
					openRequestId={0}
					onSelectTab={onSelectTab}
					onCloseTab={onCloseTab}
					onSelectRun={vi.fn()}
					onOpenTest={vi.fn()}
				>
					<div>Editor</div>
				</TestDrawerLayout>
			</TooltipProvider>
		</QueryClientProvider>,
	);
}
