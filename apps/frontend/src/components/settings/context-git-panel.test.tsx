// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextGitPanel } from './context-git-panel';

const mocks = vi.hoisted(() => ({
	getChangedFiles: vi.fn(),
	getRepositoryStatus: vi.fn(),
	mutation: vi.fn(),
	suggestBranchName: vi.fn(),
	updateWorktree: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => vi.fn(),
}));

vi.mock('@/main', () => ({
	trpc: {
		contextExplorer: {
			getRepositoryStatus: {
				queryOptions: () => ({
					queryKey: ['repository-status'],
					queryFn: mocks.getRepositoryStatus,
				}),
				queryKey: () => ['repository-status'],
			},
			getChangedFiles: {
				queryOptions: () => ({
					queryKey: ['changed-files'],
					queryFn: mocks.getChangedFiles,
				}),
				queryKey: () => ['changed-files'],
			},
			suggestBranchName: {
				queryOptions: () => ({
					queryKey: ['suggest-branch-name'],
					queryFn: mocks.suggestBranchName,
				}),
				queryKey: () => ['suggest-branch-name'],
			},
			getLiveContextPullHistory: { queryKey: () => ['context-pull-history'] },
			getFileTree: { queryKey: () => ['file-tree'] },
			readFile: { queryKey: () => ['read-file'] },
			getFileDiff: { queryKey: () => ['file-diff'] },
			searchContent: { queryKey: () => ['search-content'] },
			switchBranch: { mutationOptions: mutationOptions(mocks.mutation) },
			updateWorktree: { mutationOptions: mutationOptions(mocks.updateWorktree) },
			createBranch: { mutationOptions: mutationOptions(mocks.mutation) },
			commitChanges: { mutationOptions: mutationOptions(mocks.mutation) },
			createBranchAndCommit: { mutationOptions: mutationOptions(mocks.mutation) },
			pushBranch: { mutationOptions: mutationOptions(mocks.mutation) },
			discardLocalChange: { mutationOptions: mutationOptions(mocks.mutation) },
			discardAllChanges: { mutationOptions: mutationOptions(mocks.mutation) },
		},
	},
}));

describe('ContextGitPanel update action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mocks.getChangedFiles.mockResolvedValue([]);
		mocks.getRepositoryStatus.mockResolvedValue(createRepositoryStatus(true));
		mocks.suggestBranchName.mockResolvedValue('nao/context-edits');
		mocks.updateWorktree.mockResolvedValue({ branch: 'main', commit: 'a'.repeat(40) });
	});

	afterEach(cleanup);

	it('does not show the update action when File Explorer is current', async () => {
		mocks.getRepositoryStatus.mockResolvedValue(createRepositoryStatus(false));
		renderPanel();

		await screen.findByText('Nothing to commit');

		expect(screen.queryByRole('button', { name: 'Update File Explorer' })).toBeNull();
	});

	it('opens the update dialog from a collapsed Git header without updating first', async () => {
		localStorage.setItem('sidebar-collapsed-sections', JSON.stringify(['context-explorer-git']));
		mocks.getRepositoryStatus.mockResolvedValue(createRepositoryStatus(true));
		const { container } = renderPanel();

		const updateButton = await screen.findByRole('button', { name: 'Update File Explorer' });
		const content = container.querySelector('[data-slot="accordion-content"]');
		expect(content?.getAttribute('data-state')).toBe('closed');

		fireEvent.click(updateButton);

		expect(await screen.findByText('Update File Explorer?')).toBeTruthy();
		expect(content?.getAttribute('data-state')).toBe('closed');
		expect(mocks.updateWorktree).not.toHaveBeenCalled();
	});

	it('opens directly in the blocked state when changed files are known', async () => {
		mocks.getChangedFiles.mockResolvedValue([
			{ path: '/context.md', kind: 'modified', additions: 1, deletions: 0 },
		]);
		renderPanel();

		fireEvent.click(await screen.findByRole('button', { name: 'Update File Explorer' }));

		expect(
			await screen.findByText('File Explorer has uncommitted changes. Commit or discard them before updating.'),
		).toBeTruthy();
		expect(screen.queryByText('Finish your changes first')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Update File Explorer' })).toBeNull();
		expect(mocks.updateWorktree).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole('button', { name: 'Finish your changes' }));

		await waitFor(() => {
			expect(screen.queryByText('Update File Explorer?')).toBeNull();
		});
		expect(mocks.updateWorktree).not.toHaveBeenCalled();
	});

	it('opens the branch selector to explain why switching is blocked', async () => {
		mocks.getChangedFiles.mockResolvedValue([
			{ path: '/context.md', kind: 'modified', additions: 1, deletions: 0 },
		]);
		renderPanel();

		await screen.findByRole('button', { name: 'Commit' });
		fireEvent.pointerDown(screen.getByRole('button', { name: 'Current repository branch' }), {
			button: 0,
			ctrlKey: false,
		});

		const branch = await screen.findByRole('menuitemcheckbox', { name: /main/ });
		expect(branch.hasAttribute('data-disabled')).toBe(true);
		expect(screen.getByText('Commit or discard changes before switching branches.')).toBeTruthy();
	});

	it('turns a server dirty conflict into the blocked state', async () => {
		mocks.updateWorktree.mockRejectedValue(new Error('Commit or discard changes before switching branches.'));
		renderPanel();

		fireEvent.click(await screen.findByRole('button', { name: 'Update File Explorer' }));
		fireEvent.click(await screen.findByRole('button', { name: 'Update File Explorer' }));

		expect(
			await screen.findByText('File Explorer has uncommitted changes. Commit or discard them before updating.'),
		).toBeTruthy();
		expect(screen.queryByText('Finish your changes first')).toBeNull();
		expect(screen.queryByText('Commit or discard changes before switching branches.')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Update File Explorer' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Finish your changes' })).toBeTruthy();
		expect(mocks.updateWorktree).toHaveBeenCalledOnce();
	});

	it('keeps unexpected update failures in the normal error state', async () => {
		mocks.updateWorktree.mockRejectedValue(new Error('Unable to reach the repository.'));
		renderPanel();

		fireEvent.click(await screen.findByRole('button', { name: 'Update File Explorer' }));
		fireEvent.click(await screen.findByRole('button', { name: 'Update File Explorer' }));

		expect(await screen.findByText('Unable to reach the repository.')).toBeTruthy();
		expect(
			screen.queryByText('File Explorer has uncommitted changes. Commit or discard them before updating.'),
		).toBeNull();
		expect(screen.getByRole('button', { name: 'Update File Explorer' })).toBeTruthy();
	});

	it('updates a clean File Explorer after confirmation', async () => {
		const onRepositoryChanged = vi.fn();
		renderPanel({ onRepositoryChanged });

		fireEvent.click(await screen.findByRole('button', { name: 'Update File Explorer' }));
		fireEvent.click(await screen.findByRole('button', { name: 'Update File Explorer' }));

		await waitFor(() => {
			expect(mocks.updateWorktree.mock.calls[0]?.[0]).toEqual({ requiredCommits: [] });
			expect(onRepositoryChanged).toHaveBeenCalledOnce();
		});
		expect(screen.queryByText('Update File Explorer?')).toBeNull();
	});

	it('opens the branch selector before and after updating a committed File Explorer', async () => {
		renderPanel();

		await screen.findByText('Nothing to commit');
		const branchTrigger = screen.getByRole('button', { name: 'Current repository branch' });
		fireEvent.pointerDown(branchTrigger, { button: 0, ctrlKey: false });
		expect(await screen.findByRole('menuitemcheckbox', { name: /main/ })).toBeTruthy();

		fireEvent.keyDown(document, { key: 'Escape' });
		await waitFor(() => {
			expect(screen.queryByRole('menuitemcheckbox', { name: /main/ })).toBeNull();
		});

		mocks.getRepositoryStatus.mockResolvedValue(createRepositoryStatus(false));
		fireEvent.click(screen.getByRole('button', { name: 'Update File Explorer' }));
		fireEvent.click(await screen.findByRole('button', { name: 'Update File Explorer' }));

		await waitFor(() => {
			expect(screen.queryByText('Update File Explorer?')).toBeNull();
		});
		await waitFor(() => {
			expect(screen.queryByRole('button', { name: 'Update File Explorer' })).toBeNull();
		});
		expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
		expect(document.body.style.pointerEvents).not.toBe('none');
		expect(branchTrigger.hasAttribute('disabled')).toBe(false);
		expect(screen.getByRole('button', { name: 'Git' }).parentElement?.className).toContain('w-auto');
		fireEvent.pointerDown(branchTrigger, { button: 0, ctrlKey: false });

		expect(await screen.findByRole('menuitemcheckbox', { name: /main/ })).toBeTruthy();
	});
});

function renderPanel({
	hasUnsavedFileChanges = false,
	onRepositoryChanged = vi.fn(),
}: {
	hasUnsavedFileChanges?: boolean;
	onRepositoryChanged?: () => void;
} = {}) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<ContextGitPanel
				selectedDiffPath={null}
				hasUnsavedFileChanges={hasUnsavedFileChanges}
				onViewDiff={vi.fn()}
				onCommitted={vi.fn()}
				onDiscarded={vi.fn()}
				onDiscardAll={vi.fn()}
				onRepositoryChanged={onRepositoryChanged}
			/>
		</QueryClientProvider>,
	);
}

function createRepositoryStatus(updateNeeded: boolean) {
	return {
		gitUnavailableReason: null,
		gitUnavailableMessage: null,
		repo: {
			platform: 'github',
		},
		branches: {
			branches: ['main', 'nao/context-edits'],
			currentBranch: 'nao/context-edits',
			defaultBranch: 'main',
			suggestedBranch: 'nao/context-edits',
			aheadCommitCount: 0,
			unpushedCommitCount: 0,
		},
		openReviewRequest: null,
		fileExplorerUpdate: {
			updateNeeded,
			branch: 'main',
		},
	};
}

function mutationOptions(mutationFn: typeof mocks.mutation) {
	return (options: object) => ({
		mutationFn,
		...options,
	});
}
