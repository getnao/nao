// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestQueryClient } from '../../helpers/query-client';
import { SyncedRepos } from '@/components/settings/synced-repos';

const mocks = vi.hoisted(() => ({
	listUpstreamRepos: vi.fn(),
	getUpstreamChanges: vi.fn(),
	listRuns: vi.fn(),
}));

vi.mock('@/lib/active-project', async (importOriginal) => ({
	...(await importOriginal<object>()),
	useActiveProjectId: () => null,
}));

vi.mock('@/main', () => ({
	trpc: {
		testRun: {
			listUpstreamRepos: { queryOptions: () => ({ queryKey: ['repos'], queryFn: mocks.listUpstreamRepos }) },
			listUpstreamBranches: { queryOptions: () => ({ queryKey: ['branches'], queryFn: () => [] }) },
			getUpstreamChanges: {
				queryOptions: (input: { repo: string; branch: string }) => ({
					queryKey: ['upstream-changes', input],
					queryFn: () => mocks.getUpstreamChanges(input),
				}),
			},
			listRuns: { queryOptions: () => ({ queryKey: ['runs'], queryFn: mocks.listRuns }) },
			getDraftContext: {
				queryOptions: () => ({ queryKey: ['draft-context'], queryFn: () => ({ status: 'none' }) }),
			},
		},
	},
}));

const REVENUE_PATH = 'repos/business/metrics/revenue.md';

describe('SyncedRepos', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.listUpstreamRepos.mockResolvedValue([{ name: 'business', url: 'https://example.com', branch: 'main' }]);
		mocks.listRuns.mockResolvedValue([]);
		mocks.getUpstreamChanges.mockResolvedValue({
			ref: 'business:analyst/net-revenue',
			commit: 'def456',
			reviewRequest: {
				url: 'https://github.com/acme/business/pull/87',
				state: 'open',
				mergedAt: null,
				closedAt: null,
			},
			changes: [
				{ path: REVENUE_PATH, kind: 'modified', productionContent: 'a\n', branchContent: 'b\n' },
				{
					path: 'repos/business/legacy/kpis.md',
					kind: 'deleted',
					productionContent: 'c\n',
					branchContent: null,
				},
			],
		});
	});

	afterEach(() => {
		cleanup();
		localStorage.clear();
	});

	it('shows nothing when the context syncs no repository', async () => {
		mocks.listUpstreamRepos.mockResolvedValue([]);
		const { container } = renderRepos();

		await vi.waitFor(() => expect(mocks.listUpstreamRepos).toHaveBeenCalled());

		expect(container.textContent).toBe('');
	});

	it('folds the repositories on their production branch without syncing any branch', async () => {
		renderRepos();

		fireEvent.click(await screen.findByRole('button', { name: /Synced repos/, expanded: false }));

		expect(screen.getByRole('group', { name: 'business' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Branch of business: main' }).textContent).toBe('main');
		expect(mocks.getUpstreamChanges).not.toHaveBeenCalled();
	});

	it('lists what the picked branch changes, opens a change and tests the branch', async () => {
		localStorage.setItem(
			'nao-test-upstream-source',
			JSON.stringify({ repo: 'business', branch: 'analyst/net-revenue' }),
		);
		const onViewDiff = vi.fn();
		const onOpenTests = vi.fn();
		renderRepos({ onViewDiff, onOpenTests });

		fireEvent.click(await screen.findByRole('button', { name: 'View changes to revenue.md' }));
		fireEvent.click(screen.getByRole('button', { name: 'Test this branch' }));

		expect(onViewDiff).toHaveBeenCalledWith(REVENUE_PATH);
		expect(onOpenTests).toHaveBeenCalled();
		expect(screen.getByRole('button', { name: 'View changes to kpis.md' })).toBeTruthy();
		expect(screen.getByRole('link', { name: /#87/ }).getAttribute('href')).toBe(
			'https://github.com/acme/business/pull/87',
		);
	});

	it.each([
		{ testedCommit: 'def456', title: '8 of 8 tests passed on the latest run' },
		{ testedCommit: 'abc123', title: '8 of 8 tests passed before the latest changes. Test again' },
	])('tells whether the latest run tested the branch head ($testedCommit)', async ({ testedCommit, title }) => {
		localStorage.setItem(
			'nao-test-upstream-source',
			JSON.stringify({ repo: 'business', branch: 'analyst/net-revenue' }),
		);
		mocks.listRuns.mockResolvedValue([
			{
				status: 'completed',
				trigger: 'changes',
				contextRef: 'business:analyst/net-revenue',
				contextCommit: testedCommit,
				testTotals: [{ contextVariant: 'draft', testCount: 8, passedTests: 8 }],
			},
		]);
		renderRepos();

		await vi.waitFor(() =>
			expect(screen.getByRole('button', { name: 'Test this branch' }).getAttribute('title')).toBe(title),
		);
	});
});

function renderRepos({ onViewDiff = vi.fn(), onOpenTests = vi.fn() } = {}) {
	return render(
		<QueryClientProvider client={createTestQueryClient()}>
			<SyncedRepos selectedPath={null} onViewDiff={onViewDiff} onOpenTests={onOpenTests} />
		</QueryClientProvider>,
	);
}
