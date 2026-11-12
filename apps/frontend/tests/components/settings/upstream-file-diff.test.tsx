// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '../../helpers/query-client';
import type { ReactNode } from 'react';

import { UpstreamFileDiff } from '@/components/settings/upstream-file-diff';

const mocks = vi.hoisted(() => ({ getUpstreamChanges: vi.fn() }));

vi.mock('@/lib/active-project', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/lib/active-project')>()),
	useActiveProjectId: () => null,
}));

vi.mock('@/main', () => ({
	trpc: {
		testRun: {
			listUpstreamRepos: {
				queryOptions: () => ({
					queryKey: ['upstream-repos'],
					queryFn: () => [{ name: 'business', url: 'https://example.com', branch: 'main' }],
				}),
			},
			getUpstreamChanges: {
				queryOptions: (input: { repo: string; branch: string }) => ({
					queryKey: ['upstream-changes', input],
					queryFn: () => mocks.getUpstreamChanges(input),
				}),
			},
		},
	},
}));

const UPSTREAM = { repo: 'business', branch: 'analyst/net-revenue' };
const REVENUE_PATH = 'repos/business/metrics/revenue.md';

describe('UpstreamFileDiff', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getUpstreamChanges.mockResolvedValue({
			ref: 'business:analyst/net-revenue',
			commit: 'def456',
			reviewRequest: null,
			changes: [
				{
					path: REVENUE_PATH,
					kind: 'modified',
					productionContent: '# Revenue\nEvery order counts.\n',
					branchContent: '# Revenue\nReturned orders do not count.\n',
				},
				{
					path: 'repos/business/metrics/margin.md',
					kind: 'added',
					productionContent: null,
					branchContent: 'Margin\n',
				},
			],
		});
	});

	afterEach(() => {
		cleanup();
		localStorage.clear();
	});

	it('shows the production content of a changed file against the branch one', async () => {
		pickUpstreamBranch();
		renderWithProviders(<UpstreamFileDiff path={REVENUE_PATH} />);
		fireEvent.click(await screen.findByRole('button', { name: 'Lines' }));

		expect(screen.getByText('Returned orders do not count.')).toBeTruthy();
		expect(screen.getByText('Every order counts.')).toBeTruthy();
		expect(screen.getByText('+1')).toBeTruthy();
		expect(screen.getByText('-1')).toBeTruthy();
	});
});

function pickUpstreamBranch() {
	localStorage.setItem('nao-test-upstream-source', JSON.stringify(UPSTREAM));
}

function renderWithProviders(children: ReactNode) {
	return render(<QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>);
}
