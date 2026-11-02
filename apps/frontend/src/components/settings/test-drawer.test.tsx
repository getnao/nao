// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TestDrawerLayout } from './test-drawer';

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
		testRun: {
			listRuns: {
				queryOptions: () => ({ queryKey: ['test-runs'], queryFn: mocks.listRuns }),
				queryKey: () => [],
			},
			getDraftContext: {
				queryOptions: () => ({ queryKey: ['draft-context'], queryFn: () => ({ status: 'unavailable' }) }),
				queryKey: () => ['draft-context'],
			},
			listTests: { queryKey: () => ['tests'] },
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

	it('keeps the editor above a bar with the open test, all the tests and the run in progress', async () => {
		renderDrawer('/tests/sales/revenue.yml');

		expect(screen.getByText('Editor')).toBeTruthy();
		expect(screen.getByRole('tab', { name: 'revenue.yml' })).toBeTruthy();
		fireEvent.click(screen.getByRole('tab', { name: 'All tests' }));
		await waitFor(() => expect(screen.getByText('Comparing 1/4')).toBeTruthy());
	});

	it('offers only all the tests when the open file is not a test', () => {
		renderDrawer(null);

		expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['All tests']);
	});
});

function renderDrawer(testFilePath: string | null) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<TestDrawerLayout testFilePath={testFilePath} testFile={null} request={null} onOpenTest={vi.fn()}>
				<div>Editor</div>
			</TestDrawerLayout>
		</QueryClientProvider>,
	);
}
