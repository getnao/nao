// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateExplorerQueries } from './context-git-panel';
import { LiveContextUpdateSettings } from './live-context-update-settings';

const mocks = vi.hoisted(() => ({
	fileExplorerAction: 'open',
	getHistory: vi.fn(),
	getHistoricalAction: vi.fn(),
	navigate: vi.fn(),
	pullLiveContext: vi.fn(),
	updateWorktree: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => mocks.navigate,
}));

vi.mock('@/main', () => ({
	trpc: {
		contextExplorer: {
			getLiveContextPullHistory: {
				queryOptions: () => ({
					queryKey: ['context-pull-history'],
					queryFn: mocks.getHistory,
				}),
				queryKey: () => ['context-pull-history'],
			},
			getHistoricalDiffAction: {
				queryOptions: (input: unknown) => ({
					queryKey: ['historical-diff-action', input],
					queryFn: () => mocks.getHistoricalAction(input),
				}),
			},
			pullLiveContext: {
				mutationOptions: (options: object) => ({
					mutationFn: mocks.pullLiveContext,
					...options,
				}),
			},
			updateWorktree: {
				mutationOptions: () => ({
					mutationFn: mocks.updateWorktree,
				}),
			},
			getRepositoryStatus: { queryKey: () => ['repository-status'] },
			getFileTree: { queryKey: () => ['file-tree'] },
			getChangedFiles: { queryKey: () => ['changed-files'] },
			suggestBranchName: { queryKey: () => ['suggest-branch-name'] },
			readFile: { queryKey: () => ['read-file'] },
			getFileDiff: { queryKey: (input?: unknown) => ['file-diff', input] },
			searchContent: { queryKey: () => ['search-content'] },
		},
	},
}));

describe('LiveContextUpdateSettings historical diffs', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.fileExplorerAction = 'open';
		mocks.getHistory.mockImplementation(async () => [createHistoryEntry()]);
		mocks.getHistoricalAction.mockImplementation(async () => mocks.fileExplorerAction);
		mocks.navigate.mockResolvedValue(undefined);
	});

	afterEach(cleanup);

	it('opens a ready historical diff without running the update mutation', async () => {
		renderSettings();
		const fileLink = await screen.findByRole('button', {
			name: 'Open /context.md in File Explorer',
		});

		fireEvent.click(fileLink);

		await waitFor(() => {
			expect(mocks.navigate).toHaveBeenCalledWith({
				to: '/settings/context-explorer',
				search: {
					path: '/context.md',
					from: 'a'.repeat(40),
					to: 'b'.repeat(40),
				},
			});
		});
		expect(mocks.updateWorktree).not.toHaveBeenCalled();
		expect(mocks.getHistoricalAction).toHaveBeenCalledWith({
			from: 'a'.repeat(40),
			to: 'b'.repeat(40),
		});
		expect(mocks.getHistory).toHaveBeenCalledOnce();
	});

	it('checks one range and switches locally after a branch switch', async () => {
		const switched = deferred<{ branch: string; commit: string; fetched: boolean }>();
		mocks.updateWorktree.mockReturnValue(switched.promise);
		const { queryClient } = renderSettings();
		const fileLink = await screen.findByRole('button', {
			name: 'Open /context.md in File Explorer',
		});
		mocks.fileExplorerAction = 'switch';

		await act(async () => {
			await invalidateExplorerQueries(queryClient);
		});
		const historyCallsBeforeClick = mocks.getHistory.mock.calls.length;
		fireEvent.click(fileLink);

		expect(screen.queryByText('Update File Explorer?')).toBeNull();
		await waitFor(() => {
			expect(mocks.updateWorktree.mock.calls[0]?.[0]).toEqual({
				requiredCommits: ['a'.repeat(40), 'b'.repeat(40)],
			});
		});
		expect(mocks.getHistory).toHaveBeenCalledTimes(historyCallsBeforeClick);
		expect(mocks.getHistoricalAction).toHaveBeenCalledWith({
			from: 'a'.repeat(40),
			to: 'b'.repeat(40),
		});
		expect(mocks.navigate).not.toHaveBeenCalled();

		await act(async () => {
			switched.resolve({ branch: 'main', commit: 'b'.repeat(40), fetched: false });
		});
		await waitFor(() => {
			expect(mocks.navigate).toHaveBeenCalled();
		});
	});

	it('opens confirmation for a stale worktree and cancels without Git work', async () => {
		mocks.fileExplorerAction = 'update';
		renderSettings();

		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Open /context.md in File Explorer',
			}),
		);

		expect(await screen.findByText('Update File Explorer?')).toBeTruthy();
		expect(mocks.updateWorktree).not.toHaveBeenCalled();
		expect(mocks.navigate).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

		await waitFor(() => {
			expect(screen.queryByText('Update File Explorer?')).toBeNull();
		});
		expect(mocks.updateWorktree).not.toHaveBeenCalled();
		expect(mocks.navigate).not.toHaveBeenCalled();
	});

	it('waits for the confirmed update before opening the requested diff', async () => {
		mocks.fileExplorerAction = 'update';
		const updated = deferred<{ branch: string; commit: string }>();
		mocks.updateWorktree.mockReturnValue(updated.promise);
		renderSettings();
		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Open /context.md in File Explorer',
			}),
		);

		const confirm = await screen.findByRole('button', { name: 'Update File Explorer' });
		fireEvent.click(confirm);

		await waitFor(() => {
			expect(mocks.updateWorktree.mock.calls[0]?.[0]).toEqual({
				requiredCommits: ['a'.repeat(40), 'b'.repeat(40)],
			});
		});
		expect(mocks.navigate).not.toHaveBeenCalled();
		expect(confirm.hasAttribute('disabled')).toBe(true);

		await act(async () => {
			updated.resolve({ branch: 'main', commit: 'b'.repeat(40) });
		});

		await waitFor(() => {
			expect(mocks.navigate).toHaveBeenCalledWith({
				to: '/settings/context-explorer',
				search: {
					path: '/context.md',
					from: 'a'.repeat(40),
					to: 'b'.repeat(40),
				},
			});
		});
	});

	it('turns a confirmed update conflict into blocked content and returns to File Explorer', async () => {
		mocks.fileExplorerAction = 'update';
		mocks.updateWorktree.mockRejectedValue(new Error('Commit or discard changes before switching branches.'));
		renderSettings();
		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Open /context.md in File Explorer',
			}),
		);

		fireEvent.click(await screen.findByRole('button', { name: 'Update File Explorer' }));

		expect(screen.getByText('Update File Explorer?')).toBeTruthy();
		expect(
			await screen.findByText('File Explorer has uncommitted changes. Commit or discard them before updating.'),
		).toBeTruthy();
		expect(screen.queryByText('Finish your changes first')).toBeNull();
		expect(screen.queryByText('Commit or discard changes before switching branches.')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Update File Explorer' })).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: 'Finish your changes' }));

		await waitFor(() => {
			expect(mocks.navigate).toHaveBeenCalledWith({ to: '/settings/context-explorer' });
			expect(screen.queryByText('Update File Explorer?')).toBeNull();
		});
		expect(mocks.updateWorktree).toHaveBeenCalledOnce();
	});

	it('opens and cancels the dirty worktree dialog without Git work', async () => {
		mocks.fileExplorerAction = 'blocked';
		renderSettings();

		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Open /context.md in File Explorer',
			}),
		);

		expect(await screen.findByText('Finish your changes first')).toBeTruthy();
		expect(
			screen.getByText(
				'File Explorer has uncommitted changes. Commit or discard them before viewing these changes.',
			),
		).toBeTruthy();
		expect(screen.queryByText('Commit or discard changes before switching branches.')).toBeNull();
		expect(screen.queryByText('Update File Explorer?')).toBeNull();
		expect(mocks.updateWorktree).not.toHaveBeenCalled();
		expect(mocks.navigate).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

		await waitFor(() => {
			expect(screen.queryByText('Finish your changes first')).toBeNull();
		});
		expect(mocks.updateWorktree).not.toHaveBeenCalled();
		expect(mocks.navigate).not.toHaveBeenCalled();
	});

	it('opens File Explorer from the dirty worktree dialog without Git work', async () => {
		mocks.fileExplorerAction = 'blocked';
		renderSettings();

		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Open /context.md in File Explorer',
			}),
		);
		fireEvent.click(await screen.findByRole('button', { name: 'Open File Explorer' }));

		expect(mocks.navigate).toHaveBeenCalledWith({ to: '/settings/context-explorer' });
		expect(mocks.updateWorktree).not.toHaveBeenCalled();
		expect(screen.queryByText('Commit or discard changes before switching branches.')).toBeNull();
	});

	it('opens the dirty worktree dialog when the local switch is blocked', async () => {
		mocks.fileExplorerAction = 'switch';
		mocks.updateWorktree.mockRejectedValue(new Error('Commit or discard changes before switching branches.'));
		renderSettings();

		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Open /context.md in File Explorer',
			}),
		);

		expect(await screen.findByText('Finish your changes first')).toBeTruthy();
		expect(mocks.updateWorktree).toHaveBeenCalledOnce();
		expect(mocks.navigate).not.toHaveBeenCalled();
		expect(screen.queryByText('Commit or discard changes before switching branches.')).toBeNull();
	});
});

function renderSettings() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
	const view = render(
		<QueryClientProvider client={queryClient}>
			<LiveContextUpdateSettings
				status={{
					enabled: true,
					available: true,
					configuredBranch: 'main',
					unavailableReason: null,
					configurationError: null,
				}}
				repository={null}
				isAdmin={true}
			/>
		</QueryClientProvider>,
	);
	return { ...view, queryClient };
}

function createHistoryEntry() {
	return {
		id: 'pull-1',
		status: 'completed',
		startedAt: new Date('2026-08-31T10:00:00.000Z'),
		completedAt: new Date('2026-08-31T10:01:00.000Z'),
		changed: true,
		oldCommit: 'a'.repeat(40),
		newCommit: 'b'.repeat(40),
		fileCount: 1,
		files: [{ path: '/context.md', additions: 1, deletions: 1 }],
		errorMessage: null,
		fileExplorerAction: mocks.fileExplorerAction,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}
