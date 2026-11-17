// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudSyncPanel } from '@/components/settings/cloud-sync';

const mocks = vi.hoisted(() => ({
	cancel: vi.fn(),
	getStatus: vi.fn(),
	invalidateExplorerQueries: vi.fn(),
	start: vi.fn(),
}));

vi.mock('@/lib/context-explorer-queries', () => ({
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
					mutationFn: mocks.cancel,
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
		mocks.cancel.mockResolvedValue(undefined);
	});

	afterEach(cleanup);

	it('starts a project sync from the panel', async () => {
		renderPanel();

		const syncButton = await screen.findByRole('button', { name: 'Sync project' });
		await waitFor(() => expect(syncButton.hasAttribute('disabled')).toBe(false));
		fireEvent.click(syncButton);

		await waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
	});

	it.each(['succeeded', 'failed', 'cancelled', 'completed_with_errors'])(
		'refreshes the explorer after a %s sync',
		async (status) => {
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
		},
	);

	it('shows an amber completed-with-errors result and offers a retry', async () => {
		const message = 'Sync completed with errors. Review the terminal output above for more details.';
		mocks.getStatus.mockResolvedValue({
			available: true,
			unavailableReason: null,
			syncingBy: null,
			run: {
				id: 'run-1',
				status: 'completed_with_errors',
				logs: 'Confluence failed\n',
				error: message,
				createdAt: new Date(),
				startedAt: new Date(),
				finishedAt: new Date(),
			},
		});
		const { container } = renderPanel();

		expect(await screen.findByText('Completed with errors')).toBeTruthy();
		expect(container.querySelector('.lucide-circle-dot')).toBeTruthy();
		expect(screen.getByText(message).className).toContain('text-amber-400');
		expect(screen.getByRole('button', { name: 'Retry sync' })).toBeTruthy();
		expect(screen.queryByText('Failed')).toBeNull();
	});

	it("refreshes the explorer when another admin's sync finishes", async () => {
		mocks.getStatus.mockResolvedValue({
			available: true,
			unavailableReason: null,
			run: null,
			syncingBy: 'Gary',
		});
		const { queryClient } = renderPanel();

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

	it('shows that cancellation may take a minute immediately after stop is clicked', async () => {
		mocks.getStatus.mockResolvedValue({
			available: true,
			unavailableReason: null,
			syncingBy: null,
			run: {
				id: 'run-1',
				status: 'queued',
				logs: '',
				error: null,
				createdAt: new Date(),
				startedAt: null,
				finishedAt: null,
			},
		});
		mocks.cancel.mockReturnValue(new Promise(() => undefined));
		renderPanel();

		fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));

		expect(await screen.findByText('Cancelling sync... This may take a minute.')).toBeTruthy();
		expect(screen.getByText('Cancelling')).toBeTruthy();
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
				<CloudSyncPanel isAdmin />
			</QueryClientProvider>,
		),
	};
}
