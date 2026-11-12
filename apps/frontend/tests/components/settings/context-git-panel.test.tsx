// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openDropdownMenu } from '../../helpers/dropdown-menu';
import { createTestQueryClient } from '../../helpers/query-client';
import { ContextGitPanel } from '@/components/settings/context-git-panel';

const mocks = vi.hoisted(() => ({
	getChangedFiles: vi.fn(),
	getRepositoryStatus: vi.fn(),
	mutation: vi.fn(),
	commitChanges: vi.fn(),
	pushBranch: vi.fn(),
	generateCommitMessage: vi.fn(),
	undoLastCommit: vi.fn(),
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
			commitChanges: { mutationOptions: mutationOptions(mocks.commitChanges) },
			createBranchAndCommit: { mutationOptions: mutationOptions(mocks.mutation) },
			generateCommitMessage: { mutationOptions: mutationOptions(mocks.generateCommitMessage) },
			undoLastCommit: { mutationOptions: mutationOptions(mocks.undoLastCommit) },
			pushBranch: { mutationOptions: mutationOptions(mocks.pushBranch) },
			discardLocalChange: { mutationOptions: mutationOptions(mocks.mutation) },
			discardAllChanges: { mutationOptions: mutationOptions(mocks.mutation) },
		},
		testRun: {
			listRuns: { queryOptions: () => ({ queryKey: ['runs'], queryFn: () => [] }) },
			listUpstreamRepos: { queryOptions: () => ({ queryKey: ['upstream-repos'], queryFn: () => [] }) },
		},
	},
}));

describe('ContextGitPanel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mocks.getChangedFiles.mockResolvedValue([]);
		mocks.getRepositoryStatus.mockResolvedValue(createRepositoryStatus(true));
		mocks.suggestBranchName.mockResolvedValue('nao/context-edits');
		mocks.updateWorktree.mockResolvedValue({ branch: 'main', commit: 'a'.repeat(40) });
		mocks.commitChanges.mockResolvedValue({ commit: 'b'.repeat(40) });
		mocks.pushBranch.mockResolvedValue({
			reviewRequest: { kind: 'created', url: 'https://github.com/acme/context/pull/142' },
		});
		mocks.generateCommitMessage.mockResolvedValue('Document net revenue on orders');
	});

	afterEach(cleanup);

	it('does not show the update action when File Explorer is current', async () => {
		mocks.getRepositoryStatus.mockResolvedValue(createRepositoryStatus(false));
		renderPanel();

		await screen.findByText('Nothing to commit');

		expect(screen.queryByRole('button', { name: 'Update File Explorer' })).toBeNull();
	});

	it('opens the update dialog from the banner without updating first', async () => {
		renderPanel();

		fireEvent.click(await screen.findByRole('button', { name: 'Update File Explorer' }));

		expect(await screen.findByText('Update File Explorer?')).toBeTruthy();
		expect(mocks.updateWorktree).not.toHaveBeenCalled();
	});

	it('opens directly in the blocked state when changed files are known', async () => {
		mockUncommittedChange();
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
		mockUncommittedChange();
		renderPanel();

		await screen.findByRole('button', { name: 'Commit & push' });
		openDropdownMenu('Current repository branch');

		const branch = await screen.findByRole('menuitemcheckbox', { name: /main/ });
		expect(branch.hasAttribute('data-disabled')).toBe(true);
		expect(screen.getByText('Commit or discard changes before switching branches.')).toBeTruthy();
	});

	it('turns a server dirty conflict into the blocked state', async () => {
		mocks.updateWorktree.mockRejectedValue(new Error('Commit or discard changes before switching branches.'));
		renderPanel();

		await confirmFileExplorerUpdate();

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

		await confirmFileExplorerUpdate();

		expect(await screen.findByText('Unable to reach the repository.')).toBeTruthy();
		expect(
			screen.queryByText('File Explorer has uncommitted changes. Commit or discard them before updating.'),
		).toBeNull();
		expect(screen.getByRole('button', { name: 'Update File Explorer' })).toBeTruthy();
	});

	it('updates a clean File Explorer after confirmation', async () => {
		const onRepositoryChanged = vi.fn();
		renderPanel({ onRepositoryChanged });

		await confirmFileExplorerUpdate();

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
		openDropdownMenu(branchTrigger);
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
		openDropdownMenu(branchTrigger);

		expect(await screen.findByRole('menuitemcheckbox', { name: /main/ })).toBeTruthy();
	});

	it('writes the commit message from the diff, then commits and pushes the selected files', async () => {
		mockUncommittedChange();
		const onCommitted = vi.fn(async () => {});
		renderPanel({ onCommitted });

		fireEvent.click(await screen.findByRole('button', { name: 'Write it for me' }));
		await waitFor(() => {
			expect((screen.getByLabelText('Commit message') as HTMLTextAreaElement).value).toBe(
				'Document net revenue on orders',
			);
		});
		fireEvent.click(screen.getByRole('button', { name: 'Commit & push' }));

		await waitFor(() => expect(mocks.pushBranch).toHaveBeenCalledOnce());
		expect(mocks.generateCommitMessage.mock.calls[0]?.[0]).toEqual({ paths: ['/context.md'] });
		expect(mocks.commitChanges.mock.calls[0]?.[0]).toEqual({
			paths: ['/context.md'],
			message: 'Document net revenue on orders',
		});
		expect(onCommitted).toHaveBeenCalledWith(['/context.md']);
	});

	it('lists the commits not pushed yet and takes the last one back', async () => {
		mocks.getRepositoryStatus.mockResolvedValue(
			createRepositoryStatus(false, {
				aheadCommitCount: 1,
				unpushedCommitCount: 1,
				unpushedCommits: [
					{ hash: 'c'.repeat(40), subject: 'Document refunds', committedAt: new Date().toISOString() },
				],
			}),
		);
		renderPanel();

		expect(await screen.findByText('Document refunds')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Push commits' }).textContent).toBe('Push & open PR');
		fireEvent.click(screen.getByRole('button', { name: 'Undo last commit' }));

		await waitFor(() => expect(mocks.undoLastCommit).toHaveBeenCalledOnce());
	});

	it('offers to test a draft and to connect a repository to publish it', async () => {
		mocks.getRepositoryStatus.mockResolvedValue({
			...createRepositoryStatus(false),
			gitUnavailableReason: 'no-repo',
			branches: null,
			repo: null,
		});
		mockUncommittedChange();
		const onOpenTests = vi.fn();
		renderPanel({ onOpenTests });

		fireEvent.click(await screen.findByRole('button', { name: 'Test vs production' }));

		expect(onOpenTests).toHaveBeenCalled();
		expect(screen.getByRole('button', { name: 'Connect a repository' })).toBeTruthy();
		expect(screen.queryByRole('checkbox', { name: /in commit/ })).toBeNull();
	});
});

function renderPanel({
	onRepositoryChanged = vi.fn(),
	onCommitted = vi.fn(async () => {}),
	onOpenTests = vi.fn(),
}: {
	onRepositoryChanged?: () => void;
	onCommitted?: (paths: string[]) => Promise<void>;
	onOpenTests?: () => void;
} = {}) {
	return render(
		<QueryClientProvider client={createTestQueryClient()}>
			<ContextGitPanel
				selectedDiffPath={null}
				selectedUpstreamDiffPath={null}
				hasUnsavedFileChanges={false}
				onViewDiff={vi.fn()}
				onViewUpstreamDiff={vi.fn()}
				onCommitted={onCommitted}
				onDiscarded={vi.fn()}
				onDiscardAll={vi.fn()}
				onRepositoryChanged={onRepositoryChanged}
				onOpenTests={onOpenTests}
			/>
		</QueryClientProvider>,
	);
}

async function confirmFileExplorerUpdate() {
	fireEvent.click(await screen.findByRole('button', { name: 'Update File Explorer' }));
	fireEvent.click(await screen.findByRole('button', { name: 'Update File Explorer' }));
}

function mockUncommittedChange() {
	mocks.getChangedFiles.mockResolvedValue([{ path: '/context.md', kind: 'modified', additions: 1, deletions: 0 }]);
}

function createRepositoryStatus(
	updateNeeded: boolean,
	branchOverrides: { aheadCommitCount?: number; unpushedCommitCount?: number; unpushedCommits?: object[] } = {},
) {
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
			unpushedCommits: [],
			...branchOverrides,
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
