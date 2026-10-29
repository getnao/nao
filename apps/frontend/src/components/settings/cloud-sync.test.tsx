// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
});

function renderPanel() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<CloudSyncPanel />
		</QueryClientProvider>,
	);
}
