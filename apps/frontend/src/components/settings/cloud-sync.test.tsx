// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudSyncPanel } from './cloud-sync';

const mocks = vi.hoisted(() => ({
	getStatus: vi.fn(),
	invalidateExplorerQueries: vi.fn(),
	start: vi.fn(),
}));

vi.mock('./context-git-panel', () => ({
	invalidateExplorerQueries: mocks.invalidateExplorerQueries,
}));

vi.mock('@/main', () => ({
	trpc: {
		projectSync: {
			getStatus: {
				queryOptions: () => ({
					queryKey: ['project-sync-status'],
					queryFn: mocks.getStatus,
				}),
				queryKey: () => ['project-sync-status'],
			},
			start: {
				mutationOptions: (options: object) => ({
					mutationFn: mocks.start,
					...options,
				}),
			},
			cancel: {
				mutationOptions: (options: object) => ({
					mutationFn: vi.fn(),
					...options,
				}),
			},
		},
	},
}));

describe('CloudSyncPanel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mocks.getStatus.mockResolvedValue({ available: true, unavailableReason: null, run: null });
		mocks.start.mockResolvedValue({
			id: 'run-1',
			status: 'queued',
			logs: '',
			error: null,
			createdAt: new Date(),
			startedAt: null,
			finishedAt: null,
		});
	});

	afterEach(cleanup);

	it('starts a project sync from the panel', async () => {
		renderPanel();

		fireEvent.click(await screen.findByRole('button', { name: 'Sync' }));
		fireEvent.click(await screen.findByRole('button', { name: 'Sync project' }));

		await waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
	});

	it.each(['succeeded', 'failed', 'cancelled'])('refreshes the explorer after a %s sync', async (status) => {
		const { queryClient } = renderPanel();

		await waitFor(() => expect(queryClient.getQueryData(['project-sync-status'])).toBeDefined());
		act(() => {
			queryClient.setQueryData(['project-sync-status'], {
				available: true,
				unavailableReason: null,
				syncingBy: null,
				run: {
					id: 'run-1',
					status,
					logs: '',
					error: null,
					createdAt: new Date(),
					startedAt: new Date(),
					finishedAt: new Date(),
				},
			});
		});

		await waitFor(() => expect(mocks.invalidateExplorerQueries).toHaveBeenCalledOnce());
	});

	it("refreshes the explorer when another admin's sync finishes", async () => {
		mocks.getStatus.mockResolvedValue({
			available: true,
			unavailableReason: null,
			run: null,
			syncingBy: 'Gary',
		});
		const { queryClient } = renderPanel();

		fireEvent.click(await screen.findByRole('button', { name: 'Sync' }));
		await screen.findByText('Project is currently being synced by Gary');
		expect(mocks.invalidateExplorerQueries).not.toHaveBeenCalled();

		act(() => {
			queryClient.setQueryData(['project-sync-status'], {
				available: true,
				unavailableReason: null,
				run: null,
				syncingBy: null,
			});
		});

		await waitFor(() => expect(mocks.invalidateExplorerQueries).toHaveBeenCalledOnce());
	});
});

function renderPanel() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return {
		queryClient,
		...render(
			<QueryClientProvider client={queryClient}>
				<CloudSyncPanel />
			</QueryClientProvider>,
		),
	};
}
