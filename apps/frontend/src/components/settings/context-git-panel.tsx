import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, FlaskConical, GitBranch, GitPullRequest, PenLine, Plus, RefreshCw, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { ContextChangedFile } from '@nao/shared/types';

import type { ChangesRunResult } from '@/hooks/use-latest-changes-run';
import { ChangedFileList } from '@/components/settings/changed-file-list';
import { ChangesSection } from '@/components/settings/changes-section';
import { CommitComposer } from '@/components/settings/commit-composer';
import {
	ContextWorktreeUpdateDialog,
	isDirtyWorktreeConflict,
} from '@/components/settings/context-worktree-update-dialog';
import { OutgoingCommits } from '@/components/settings/outgoing-commits';
import { SyncedRepos } from '@/components/settings/synced-repos';
import { TestStatusButton } from '@/components/settings/test-status-button';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ErrorMessage } from '@/components/ui/error-message';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useContextChanges } from '@/hooks/use-context-changes';
import { useLatestChangesRun } from '@/hooks/use-latest-changes-run';
import { getReviewRequestNumber } from '@/lib/review-request';
import { trpc } from '@/main';

interface ContextGitPanelProps {
	selectedDiffPath: string | null;
	selectedUpstreamDiffPath: string | null;
	hasUnsavedFileChanges: boolean;
	onViewDiff: (path: string) => void;
	onViewUpstreamDiff: (path: string) => void;
	onCommitted: (paths: string[]) => Promise<void>;
	onDiscarded: (path: string) => Promise<void>;
	onDiscardAll: () => Promise<void>;
	onRepositoryChanged: () => void;
	onOpenTests: () => void;
}

type ReviewRequestState = { kind: 'created'; url: string } | { kind: 'link'; url: string; apiRefused?: boolean };

interface ReviewRequestLinkInfo {
	url: string;
	label: string;
	title: string;
}

const FALLBACK_BASE_NOTICE = 'This branch started from the current version and may need updating before review.';

/**
 * The Changes view of the File Explorer: the user's changes to the context, as a git branch to commit, push and get
 * reviewed or as a draft saved in nao, then the repositories `nao sync` copies into the context.
 */
export function ContextGitPanel({
	selectedDiffPath,
	selectedUpstreamDiffPath,
	hasUnsavedFileChanges,
	onViewDiff,
	onViewUpstreamDiff,
	onCommitted,
	onDiscarded,
	onDiscardAll,
	onRepositoryChanged,
	onOpenTests,
}: ContextGitPanelProps) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
	const [discardFile, setDiscardFile] = useState<ContextChangedFile | null>(null);
	const [isDiscardAllOpen, setIsDiscardAllOpen] = useState(false);
	const [isCreateBranchOpen, setIsCreateBranchOpen] = useState(false);
	const [isUpdateWorktreeOpen, setIsUpdateWorktreeOpen] = useState(false);
	const [isUpdateWorktreeBlocked, setIsUpdateWorktreeBlocked] = useState(false);
	const [newBranchName, setNewBranchName] = useState('');
	const [commitMessage, setCommitMessage] = useState('');
	const [fallbackBaseNotice, setFallbackBaseNotice] = useState(false);
	const [pushedReviewRequest, setPushedReviewRequest] = useState<ReviewRequestState | null>(null);
	const knownChangedPathsRef = useRef<Set<string>>(new Set());

	const { repositoryStatus, changedFiles, isGitAvailable, isNaoDraft } = useContextChanges();
	const status = repositoryStatus.data;
	const branches = status?.branches ?? null;
	const currentBranch = branches?.currentBranch ?? null;
	const defaultBranch = branches?.defaultBranch ?? null;
	const suggestedBranchName = useQuery({
		...trpc.contextExplorer.suggestBranchName.queryOptions(),
		enabled: isGitAvailable && currentBranch === defaultBranch,
	});
	const latestRun = useLatestChangesRun(
		isGitAvailable || isNaoDraft ? { kind: 'own', branch: isNaoDraft ? null : currentBranch } : null,
	);
	const changedFileList = changedFiles.data ?? [];
	const hasUncommittedChanges = changedFileList.length > 0;
	const hasKnownDirtyWorktree = hasUnsavedFileChanges || hasUncommittedChanges;
	const commitBranchName = suggestedBranchName.data?.trim() || branches?.suggestedBranch.trim() || null;

	useEffect(() => {
		if (!changedFiles.data) {
			return;
		}
		const changedPaths = new Set(changedFiles.data.map((file) => file.path));
		const knownPaths = knownChangedPathsRef.current;
		knownChangedPathsRef.current = changedPaths;
		setSelectedPaths((selected) => {
			const next = new Set([...selected].filter((path) => changedPaths.has(path)));
			for (const path of changedPaths) {
				if (!knownPaths.has(path)) {
					next.add(path);
				}
			}
			return areSetsEqual(selected, next) ? selected : next;
		});
	}, [changedFiles.data]);

	useEffect(() => {
		setPushedReviewRequest(null);
	}, [currentBranch]);

	const refreshExplorer = async (resetViewer: boolean) => {
		await invalidateExplorerQueries(queryClient);
		if (resetViewer) {
			onRepositoryChanged();
		}
	};

	const switchBranch = useMutation(
		trpc.contextExplorer.switchBranch.mutationOptions({
			onSuccess: async () => {
				await refreshExplorer(true);
			},
		}),
	);

	const updateWorktree = useMutation(
		trpc.contextExplorer.updateWorktree.mutationOptions({
			onSuccess: () => {
				setIsUpdateWorktreeOpen(false);
				setIsUpdateWorktreeBlocked(false);
				onRepositoryChanged();
				void invalidateExplorerQueries(queryClient);
			},
			onError: (error) => {
				if (isDirtyWorktreeConflict(error)) {
					setIsUpdateWorktreeBlocked(true);
				}
			},
		}),
	);

	const createBranch = useMutation(
		trpc.contextExplorer.createBranch.mutationOptions({
			onSuccess: async (result) => {
				setIsCreateBranchOpen(false);
				setNewBranchName('');
				setFallbackBaseNotice(result.usedFallbackBase);
				await refreshExplorer(true);
			},
		}),
	);

	const commitChanges = useMutation(
		trpc.contextExplorer.commitChanges.mutationOptions({
			onSuccess: async (_result, variables) => {
				await handleCommitSuccess(variables.paths, currentBranch, false);
				await refreshExplorer(false);
			},
		}),
	);

	const createBranchAndCommit = useMutation(
		trpc.contextExplorer.createBranchAndCommit.mutationOptions({
			onSuccess: async (result, variables) => {
				await handleCommitSuccess(variables.paths, result.branch, result.usedFallbackBase);
				await refreshExplorer(false);
			},
		}),
	);

	const generateCommitMessage = useMutation(
		trpc.contextExplorer.generateCommitMessage.mutationOptions({
			onSuccess: (message) => setCommitMessage(message),
		}),
	);

	const pushBranch = useMutation(
		trpc.contextExplorer.pushBranch.mutationOptions({
			onSuccess: async (result) => {
				setPushedReviewRequest(result.reviewRequest);
				await refreshExplorer(false);
			},
		}),
	);

	const undoLastCommit = useMutation(
		trpc.contextExplorer.undoLastCommit.mutationOptions({
			onSuccess: async () => {
				await refreshExplorer(false);
			},
		}),
	);

	const discardChange = useMutation(
		trpc.contextExplorer.discardLocalChange.mutationOptions({
			onSuccess: async (_result, variables) => {
				await Promise.all([invalidateExplorerQueries(queryClient), onDiscarded(variables.path)]);
				setDiscardFile(null);
			},
		}),
	);

	const discardAllChanges = useMutation(
		trpc.contextExplorer.discardAllChanges.mutationOptions({
			onSuccess: async () => {
				await Promise.all([invalidateExplorerQueries(queryClient), onDiscardAll()]);
				setIsDiscardAllOpen(false);
			},
		}),
	);

	const handleCommitSuccess = async (paths: string[], branch: string | null, usedFallbackBase: boolean) => {
		await onCommitted(paths);
		if (!branch) {
			return;
		}
		setCommitMessage('');
		setSelectedPaths(new Set());
		setFallbackBaseNotice(usedFallbackBase);
	};

	const selectedChangedPaths = changedFileList
		.filter((file) => selectedPaths.has(file.path))
		.map((file) => file.path);

	const handleCommit = async ({ push }: { push: boolean }) => {
		const message = commitMessage.trim();
		if (!message || selectedChangedPaths.length === 0 || !currentBranch || !defaultBranch) {
			return;
		}
		setFallbackBaseNotice(false);
		commitChanges.reset();
		createBranchAndCommit.reset();
		try {
			if (currentBranch === defaultBranch) {
				await createBranchAndCommit.mutateAsync({
					branch: commitBranchName || undefined,
					paths: selectedChangedPaths,
					message,
				});
			} else {
				await commitChanges.mutateAsync({ paths: selectedChangedPaths, message });
			}
		} catch {
			return;
		}
		if (push) {
			handlePush();
		}
	};

	const handlePush = () => {
		setPushedReviewRequest(null);
		pushBranch.reset();
		pushBranch.mutate();
	};

	const togglePath = (path: string) => {
		setSelectedPaths((current) => {
			const next = new Set(current);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	};

	const openUpdateDialog = () => {
		updateWorktree.reset();
		setIsUpdateWorktreeBlocked(hasKnownDirtyWorktree);
		setIsUpdateWorktreeOpen(true);
	};

	const openDiscard = (file: ContextChangedFile) => {
		discardChange.reset();
		setDiscardFile(file);
	};

	const openDiscardAll = () => {
		discardAllChanges.reset();
		setIsDiscardAllOpen(true);
	};

	const commitPending = commitChanges.isPending || createBranchAndCommit.isPending;
	const commitError =
		commitChanges.error?.message ?? createBranchAndCommit.error?.message ?? generateCommitMessage.error?.message;
	const branchChangeDisabled =
		changedFiles.isLoading ||
		changedFiles.isError ||
		hasUncommittedChanges ||
		hasUnsavedFileChanges ||
		switchBranch.isPending ||
		createBranch.isPending ||
		commitPending;
	const branchChangeReason = getBranchChangeReason({
		hasUnsavedFileChanges,
		isLoading: changedFiles.isLoading,
		isError: changedFiles.isError,
		hasUncommittedChanges,
	});
	const canCommit =
		selectedChangedPaths.length > 0 &&
		commitMessage.trim().length > 0 &&
		currentBranch !== null &&
		defaultBranch !== null;
	const openReviewRequest = status?.openReviewRequest ?? null;
	const aheadCommitCount = branches?.aheadCommitCount ?? 0;
	const unpushedCommitCount = branches?.unpushedCommitCount ?? 0;
	const isReviewBranch = currentBranch !== null && defaultBranch !== null && currentBranch !== defaultBranch;
	const canPush = isReviewBranch && (unpushedCommitCount > 0 || (aheadCommitCount > 0 && openReviewRequest === null));
	const hasDraftChanges = hasUncommittedChanges || (isReviewBranch && aheadCommitCount > 0);
	const reviewRequest = pushedReviewRequest ?? openReviewRequest;
	const reviewAbbreviation = status?.repo?.platform === 'gitlab' ? 'MR' : 'PR';
	const reviewName = status?.repo?.platform === 'gitlab' ? 'merge request' : 'pull request';
	const discardDisabledReason = hasUnsavedFileChanges
		? 'Save or discard the open file before discarding saved changes.'
		: null;
	const apiRefusedNotice =
		reviewRequest?.kind === 'link' && reviewRequest.apiRefused
			? `Branch pushed. The git provider could not create the ${reviewName} automatically, so open it yourself.`
			: null;
	const reviewRequestLink = toReviewRequestLinkInfo(reviewRequest, reviewAbbreviation, reviewName);

	return (
		<div className='flex h-full min-h-0 flex-col overflow-y-auto pb-2'>
			<section aria-label={isNaoDraft ? 'Your draft' : 'Your changes'} className='flex flex-col'>
				{repositoryStatus.isLoading ? (
					<div className='flex justify-center py-6'>
						<Spinner />
					</div>
				) : repositoryStatus.isError ? (
					<div className='flex flex-col items-start gap-2 p-3'>
						<ErrorMessage message={repositoryStatus.error.message || 'Failed to load repository status'} />
						<Button variant='outline' size='pill' onClick={() => repositoryStatus.refetch()}>
							Retry
						</Button>
					</div>
				) : isNaoDraft ? (
					<NaoDraftChanges
						files={changedFileList}
						latestRun={latestRun}
						selectedDiffPath={selectedDiffPath}
						discardDisabledReason={discardDisabledReason}
						isLoading={changedFiles.isLoading}
						error={changedFiles.error?.message}
						onRetry={() => changedFiles.refetch()}
						onViewDiff={onViewDiff}
						onDiscard={openDiscard}
						onDiscardAll={openDiscardAll}
						onTest={onOpenTests}
						onSetup={() => navigate({ to: '/settings/git' })}
					/>
				) : !isGitAvailable || !branches ? (
					<UnavailableGit
						message={status?.gitUnavailableMessage ?? 'Git actions are unavailable for this project.'}
						onSetup={() => navigate({ to: '/settings/git' })}
					/>
				) : (
					<>
						<PanelBar>
							<BranchMenu
								branches={branches.branches}
								currentBranch={currentBranch}
								defaultBranch={branches.defaultBranch}
								disabled={branchChangeDisabled}
								reason={branchChangeReason}
								onSwitch={(branch) => {
									if (branch !== currentBranch) {
										switchBranch.mutate({ branch });
									}
								}}
								onCreate={() => {
									createBranch.reset();
									setIsCreateBranchOpen(true);
								}}
							/>
							{hasDraftChanges && (
								<TestStatusButton label='Test your changes' result={latestRun} onClick={onOpenTests} />
							)}
							{reviewRequestLink && <ReviewRequestLink link={reviewRequestLink} />}
							{status?.fileExplorerUpdate?.updateNeeded === true && (
								<UpdateButton branch={status.fileExplorerUpdate.branch} onUpdate={openUpdateDialog} />
							)}
						</PanelBar>
						<div className='flex flex-col gap-1.5 empty:hidden'>
							{hasUncommittedChanges ? (
								<CommitComposer
									message={commitMessage}
									selectedCount={selectedChangedPaths.length}
									changedCount={changedFileList.length}
									newBranchName={currentBranch === defaultBranch ? commitBranchName : null}
									canCommit={canCommit}
									isCommitting={commitPending || pushBranch.isPending}
									isWritingMessage={generateCommitMessage.isPending}
									onMessageChange={setCommitMessage}
									onWriteMessage={() => generateCommitMessage.mutate({ paths: selectedChangedPaths })}
									onEditBranchName={() => {
										createBranch.reset();
										setNewBranchName(commitBranchName ?? '');
										setIsCreateBranchOpen(true);
									}}
									onCommit={(options) => void handleCommit(options)}
								/>
							) : (
								canPush && (
									<Button
										variant='secondary'
										size='sm'
										className='mx-2 h-7 text-xs'
										aria-label='Push commits'
										disabled={pushBranch.isPending || undoLastCommit.isPending}
										isLoading={pushBranch.isPending}
										onClick={handlePush}
									>
										{getPushLabel(
											unpushedCommitCount,
											openReviewRequest !== null,
											reviewAbbreviation,
										)}
									</Button>
								)
							)}
							<PanelMessages
								errors={[
									switchBranch.error?.message,
									commitError,
									pushBranch.error?.message,
									undoLastCommit.error?.message,
								]}
								notice={apiRefusedNotice ?? (fallbackBaseNotice ? FALLBACK_BASE_NOTICE : null)}
							/>
						</div>
						<ChangesSection
							title='Changes'
							count={changedFileList.length}
							actions={
								hasUncommittedChanges && (
									<DiscardAllButton disabledReason={discardDisabledReason} onClick={openDiscardAll} />
								)
							}
						>
							<ChangedFileList
								files={changedFileList}
								selection={{ selectedPaths, onToggle: togglePath }}
								selectedDiffPath={selectedDiffPath}
								discardDisabledReason={discardDisabledReason}
								isLoading={changedFiles.isLoading}
								error={changedFiles.error?.message}
								emptyMessage='Nothing to commit'
								onRetry={() => changedFiles.refetch()}
								onViewDiff={onViewDiff}
								onDiscard={openDiscard}
							/>
						</ChangesSection>
						<OutgoingCommits
							commits={branches.unpushedCommits}
							isUndoing={undoLastCommit.isPending}
							disabled={pushBranch.isPending || undoLastCommit.isPending}
							onUndo={() => undoLastCommit.mutate()}
						/>
					</>
				)}
			</section>

			<SyncedRepos
				selectedPath={selectedUpstreamDiffPath}
				onViewDiff={onViewUpstreamDiff}
				onOpenTests={onOpenTests}
			/>

			<CreateBranchDialog
				open={isCreateBranchOpen}
				branchName={newBranchName}
				isPending={createBranch.isPending}
				error={createBranch.error?.message}
				onBranchNameChange={setNewBranchName}
				onOpenChange={setIsCreateBranchOpen}
				onCreate={() => createBranch.mutate({ branch: newBranchName.trim() })}
			/>
			<ContextWorktreeUpdateDialog
				open={isUpdateWorktreeOpen}
				branch={status?.fileExplorerUpdate?.branch ?? defaultBranch ?? 'the live branch'}
				isPending={updateWorktree.isPending}
				isBlocked={isUpdateWorktreeBlocked || (isUpdateWorktreeOpen && hasKnownDirtyWorktree)}
				error={updateWorktree.error?.message}
				onOpenChange={(open) => {
					if (!open && !updateWorktree.isPending) {
						setIsUpdateWorktreeOpen(false);
						setIsUpdateWorktreeBlocked(false);
						updateWorktree.reset();
					}
				}}
				onConfirm={() => {
					if (hasKnownDirtyWorktree) {
						setIsUpdateWorktreeBlocked(true);
						return;
					}
					updateWorktree.mutate({ requiredCommits: [] });
				}}
			/>
			<ConfirmationDialog
				open={discardFile !== null}
				title={getSingleDiscardTitle(discardFile)}
				description={`Are you sure you want to discard the ${isNaoDraft ? 'draft' : 'uncommitted'} changes to this file?`}
				confirmLabel='Discard'
				isPending={discardChange.isPending}
				error={discardChange.error?.message}
				preventCloseWhilePending
				onOpenChange={(open) => {
					if (!open && !discardChange.isPending) {
						setDiscardFile(null);
					}
				}}
				onConfirm={() => {
					if (discardFile) {
						discardChange.mutate({ path: discardFile.path });
					}
				}}
			/>
			<ConfirmationDialog
				open={isDiscardAllOpen}
				title='Discard all changes?'
				description={getDiscardAllDescription(changedFileList.length, isNaoDraft)}
				confirmLabel='Discard all'
				isPending={discardAllChanges.isPending}
				error={discardAllChanges.error?.message}
				preventCloseWhilePending
				onOpenChange={(open) => {
					if (!open && !discardAllChanges.isPending) {
						setIsDiscardAllOpen(false);
					}
				}}
				onConfirm={() => discardAllChanges.mutate()}
			/>
		</div>
	);
}

export async function invalidateExplorerQueries(queryClient: QueryClient): Promise<void> {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getRepositoryStatus.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getChangedFiles.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.suggestBranchName.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getLiveContextPullHistory.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getFileTree.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.readFile.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getFileDiff.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.searchContent.queryKey() }),
	]);
}

function PanelBar({ children }: { children: ReactNode }) {
	return <div className='flex h-9 shrink-0 items-center gap-1 pr-2 pl-1.5'>{children}</div>;
}

function PanelMessages({ errors, notice }: { errors: (string | undefined)[]; notice: string | null }) {
	const error = errors.find(Boolean);
	if (!error && !notice) {
		return null;
	}
	return (
		<div className='flex flex-col gap-1 px-2'>
			{error && <ErrorMessage message={error} />}
			{notice && <p className='text-[11px] text-amber-700 dark:text-amber-400'>{notice}</p>}
		</div>
	);
}

/** The live branch moved on since the File Explorer was set up, which the user brings in when ready. */
function UpdateButton({ branch, onUpdate }: { branch: string; onUpdate: () => void }) {
	return (
		<Button
			variant='ghost-muted'
			size='icon-xs'
			className='relative'
			aria-label='Update File Explorer'
			title={`${branch} has new changes. Update File Explorer`}
			onClick={onUpdate}
		>
			<RefreshCw />
			<span aria-hidden='true' className='absolute top-1 right-1 size-1.5 rounded-full bg-primary' />
		</Button>
	);
}

function ReviewRequestLink({ link }: { link: ReviewRequestLinkInfo }) {
	return (
		<a
			href={link.url}
			target='_blank'
			rel='noopener noreferrer'
			aria-label={link.title}
			title={link.title}
			className='flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] transition-colors hover:bg-muted'
		>
			<GitPullRequest className='size-3 text-emerald-600 dark:text-emerald-400' />
			{link.label}
		</a>
	);
}

function DiscardAllButton({ disabledReason, onClick }: { disabledReason: string | null; onClick: () => void }) {
	return (
		<Button
			variant='ghost-muted'
			size='icon-xs'
			className='size-5 enabled:hover:text-destructive'
			aria-label='Discard all changes'
			title={disabledReason ?? 'Discard all changes'}
			disabled={disabledReason !== null}
			onClick={onClick}
		>
			<Undo2 className='size-3' />
		</Button>
	);
}

function BranchMenu({
	branches,
	currentBranch,
	defaultBranch,
	disabled,
	reason,
	onSwitch,
	onCreate,
}: {
	branches: string[];
	currentBranch: string | null;
	defaultBranch: string;
	disabled: boolean;
	reason: string | null;
	onSwitch: (branch: string) => void;
	onCreate: () => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant='ghost'
					size='sm'
					className='mr-auto h-6 min-w-0 gap-1 px-1.5 text-[11.5px] font-normal'
					aria-label='Current repository branch'
				>
					<GitBranch className='size-3 shrink-0 text-muted-foreground' />
					<span className='truncate font-mono'>{currentBranch ?? 'Choose branch'}</span>
					<ChevronDown className='size-3 shrink-0 text-muted-foreground' />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='start' sideOffset={4} className='w-64 max-w-[calc(100vw-2rem)]'>
				{branches.map((branch) => (
					<DropdownMenuCheckboxItem
						key={branch}
						checked={branch === currentBranch}
						disabled={disabled}
						onSelect={() => onSwitch(branch)}
					>
						<span className='min-w-0 truncate'>{branch}</span>
						{branch === defaultBranch && (
							<span className='ml-auto shrink-0 text-muted-foreground'>(default)</span>
						)}
					</DropdownMenuCheckboxItem>
				))}
				{reason && <div className='px-2 py-1.5 text-xs text-muted-foreground'>{reason}</div>}
				<DropdownMenuSeparator />
				<DropdownMenuItem disabled={disabled} onSelect={onCreate}>
					<Plus className='size-3.5' />
					New branch…
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function NaoDraftChanges({
	files,
	latestRun,
	selectedDiffPath,
	discardDisabledReason,
	isLoading,
	error,
	onRetry,
	onViewDiff,
	onDiscard,
	onDiscardAll,
	onTest,
	onSetup,
}: {
	files: ContextChangedFile[];
	latestRun: ChangesRunResult | null;
	selectedDiffPath: string | null;
	discardDisabledReason: string | null;
	isLoading: boolean;
	error: string | undefined;
	onRetry: () => void;
	onViewDiff: (path: string) => void;
	onDiscard: (file: ContextChangedFile) => void;
	onDiscardAll: () => void;
	onTest: () => void;
	onSetup: () => void;
}) {
	return (
		<>
			<PanelBar>
				<span className='flex min-w-0 flex-1 items-center gap-1.5 pl-1.5 text-xs'>
					<PenLine className='size-3 shrink-0 text-muted-foreground' />
					Draft
					<span className='truncate text-muted-foreground'>· only you</span>
				</span>
				{latestRun && <TestStatusButton label='Open tests' result={latestRun} onClick={onTest} />}
			</PanelBar>
			{files.length > 0 && (
				<Button variant='secondary' size='sm' className='mx-2 h-7 text-xs' onClick={onTest}>
					<FlaskConical />
					Test vs production
				</Button>
			)}
			<ChangesSection
				title='Changes'
				count={files.length}
				actions={
					files.length > 0 && (
						<DiscardAllButton disabledReason={discardDisabledReason} onClick={onDiscardAll} />
					)
				}
			>
				<ChangedFileList
					files={files}
					selectedDiffPath={selectedDiffPath}
					discardDisabledReason={discardDisabledReason}
					isLoading={isLoading}
					error={error}
					emptyMessage='No draft changes'
					onRetry={onRetry}
					onViewDiff={onViewDiff}
					onDiscard={onDiscard}
				/>
			</ChangesSection>
			<p className='px-3 pt-1 pb-2 text-[11px] text-muted-foreground'>
				Saved in nao.{' '}
				<button type='button' className='cursor-pointer text-foreground hover:underline' onClick={onSetup}>
					Connect a repository
				</button>{' '}
				to commit it.
			</p>
		</>
	);
}

function UnavailableGit({ message, onSetup }: { message: string; onSetup: () => void }) {
	return (
		<p className='px-3 py-2.5 text-[11px] text-muted-foreground'>
			{message}{' '}
			<button type='button' className='cursor-pointer text-foreground hover:underline' onClick={onSetup}>
				Set up git
			</button>
		</p>
	);
}

function CreateBranchDialog({
	open,
	branchName,
	isPending,
	error,
	onBranchNameChange,
	onOpenChange,
	onCreate,
}: {
	open: boolean;
	branchName: string;
	isPending: boolean;
	error: string | undefined;
	onBranchNameChange: (value: string) => void;
	onOpenChange: (open: boolean) => void;
	onCreate: () => void;
}) {
	return (
		<Dialog open={open} onOpenChange={(nextOpen) => !isPending && onOpenChange(nextOpen)}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create a branch</DialogTitle>
					<DialogDescription>The new branch starts from the repository's default branch.</DialogDescription>
				</DialogHeader>
				<form
					className='flex flex-col gap-4'
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						if (!branchName.trim() || isPending) {
							return;
						}
						onCreate();
					}}
				>
					<div className='flex flex-col gap-2'>
						<label htmlFor='branch-name' className='text-sm font-medium'>
							Branch name
						</label>
						<Input
							id='branch-name'
							type='text'
							value={branchName}
							onChange={(event) => onBranchNameChange(event.target.value)}
							placeholder='nao/context-edits'
							autoFocus
						/>
					</div>
					{error && <p className='text-red-500 text-center text-sm'>{error}</p>}
					<div className='flex justify-end gap-2'>
						<Button
							type='button'
							variant='outline'
							className='rounded-full border'
							disabled={isPending}
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button
							type='submit'
							variant='primary-gradient'
							className='rounded-full'
							disabled={!branchName.trim() || isPending}
							isLoading={isPending}
						>
							Create branch
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function getPushLabel(unpushedCommitCount: number, hasReviewRequest: boolean, reviewAbbreviation: string): string {
	if (!hasReviewRequest) {
		return `Push & open ${reviewAbbreviation}`;
	}
	return `Push ${unpushedCommitCount} ${unpushedCommitCount === 1 ? 'commit' : 'commits'}`;
}

function getBranchChangeReason({
	hasUnsavedFileChanges,
	isLoading,
	isError,
	hasUncommittedChanges,
}: {
	hasUnsavedFileChanges: boolean;
	isLoading: boolean;
	isError: boolean;
	hasUncommittedChanges: boolean;
}): string | null {
	if (hasUnsavedFileChanges) {
		return 'Save or discard the open file before changing branches.';
	}
	if (isLoading) {
		return 'Checking for uncommitted changes before changing branches.';
	}
	if (isError) {
		return 'Reload changed files before changing branches.';
	}
	return hasUncommittedChanges ? 'Commit or discard changes before switching branches.' : null;
}

function toReviewRequestLinkInfo(
	reviewRequest: ReviewRequestState | null,
	abbreviation: string,
	name: string,
): ReviewRequestLinkInfo | null {
	if (!reviewRequest) {
		return null;
	}
	const number = getReviewRequestNumber(reviewRequest.url);
	if (reviewRequest.kind === 'link') {
		return { url: reviewRequest.url, label: `Open ${abbreviation}`, title: `Open ${abbreviation}` };
	}
	return {
		url: reviewRequest.url,
		label: number ? `#${number}` : abbreviation,
		title: `View ${name}${number ? ` #${number}` : ''}`,
	};
}

function getSingleDiscardTitle(file: ContextChangedFile | null): string {
	if (!file) {
		return 'Discard changes?';
	}
	const fileName = file.path.split('/').pop() ?? file.path;
	return `Discard ${fileName}?`;
}

function getDiscardAllDescription(changeCount: number, isNaoDraft: boolean): string {
	const fileCount = `${changeCount} ${changeCount === 1 ? 'file' : 'files'}`;
	return `Are you sure you want to discard the ${isNaoDraft ? 'draft' : 'uncommitted'} changes across ${fileCount}?`;
}

function areSetsEqual(left: Set<string>, right: Set<string>): boolean {
	return left.size === right.size && [...left].every((value) => right.has(value));
}
