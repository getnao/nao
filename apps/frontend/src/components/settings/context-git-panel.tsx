import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
	ArrowUp,
	ChevronDown,
	FilePen,
	FilePlus,
	FileX,
	GitBranch,
	GitPullRequest,
	Pencil,
	Plus,
	X,
} from 'lucide-react';
import type { QueryClient } from '@tanstack/react-query';
import type { ContextChangedFile } from '@nao/shared/types';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Expandable } from '@/components/ui/expandable';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useSidebarSectionOpen } from '@/hooks/use-sidebar-section-open';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

interface ContextGitPanelProps {
	selectedDiffPath: string | null;
	hasUnsavedFileChanges: boolean;
	onViewDiff: (path: string) => void;
	onCommitted: (paths: string[]) => Promise<void>;
	onDiscarded: (path: string) => Promise<void>;
	onDiscardAll: () => Promise<void>;
	onRepositoryChanged: () => void;
}

type ReviewRequestLink = { kind: 'created'; url: string } | { kind: 'link'; url: string; apiRefused?: boolean };

export function ContextGitPanel({
	selectedDiffPath,
	hasUnsavedFileChanges,
	onViewDiff,
	onCommitted,
	onDiscarded,
	onDiscardAll,
	onRepositoryChanged,
}: ContextGitPanelProps) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { isOpen, setIsOpen } = useSidebarSectionOpen('context-explorer-git');
	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
	const [discardFile, setDiscardFile] = useState<ContextChangedFile | null>(null);
	const [isDiscardAllOpen, setIsDiscardAllOpen] = useState(false);
	const [isCreateBranchOpen, setIsCreateBranchOpen] = useState(false);
	const [newBranchName, setNewBranchName] = useState('');
	const [commitMessage, setCommitMessage] = useState('');
	const [fallbackBaseNotice, setFallbackBaseNotice] = useState(false);
	const [pushedReviewRequest, setPushedReviewRequest] = useState<ReviewRequestLink | null>(null);
	const knownChangedPathsRef = useRef<Set<string>>(new Set());

	const repositoryStatus = useQuery({
		...trpc.contextExplorer.getRepositoryStatus.queryOptions(),
		staleTime: 30_000,
	});
	const status = repositoryStatus.data;
	const repo = status?.repo ?? null;
	const branches = status?.branches ?? null;
	const currentBranch = branches?.currentBranch ?? null;
	const defaultBranch = branches?.defaultBranch ?? null;
	const isGitAvailable = status?.gitUnavailableReason === null && branches !== null && repo !== null;

	const changedFiles = useQuery({
		...trpc.contextExplorer.getChangedFiles.queryOptions(),
		enabled: isGitAvailable,
	});
	const suggestedBranchName = useQuery({
		...trpc.contextExplorer.suggestBranchName.queryOptions(),
		enabled: isGitAvailable && currentBranch === defaultBranch,
	});
	const changedFileList = changedFiles.data ?? [];
	const hasUncommittedChanges = changedFileList.length > 0;
	const commitBranchName = suggestedBranchName.data?.trim() || branches?.suggestedBranch.trim() || null;

	useEffect(() => {
		if (!changedFiles.data) {
			return;
		}
		const changedPaths = new Set(changedFiles.data.map((file) => file.path));
		setSelectedPaths((selected) => {
			const next = new Set([...selected].filter((path) => changedPaths.has(path)));
			for (const path of changedPaths) {
				if (!knownChangedPathsRef.current.has(path)) {
					next.add(path);
				}
			}
			return areSetsEqual(selected, next) ? selected : next;
		});
		knownChangedPathsRef.current = changedPaths;
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

	const pushBranch = useMutation(
		trpc.contextExplorer.pushBranch.mutationOptions({
			onSuccess: async (result) => {
				setPushedReviewRequest(result.reviewRequest);
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

	const handleCommit = () => {
		const paths = changedFileList.filter((file) => selectedPaths.has(file.path)).map((file) => file.path);
		const message = commitMessage.trim();
		if (!message || paths.length === 0 || !currentBranch || !defaultBranch) {
			return;
		}
		setFallbackBaseNotice(false);
		commitChanges.reset();
		createBranchAndCommit.reset();
		if (currentBranch === defaultBranch) {
			createBranchAndCommit.mutate({
				branch: commitBranchName || undefined,
				paths,
				message,
			});
			return;
		}
		commitChanges.mutate({ paths, message });
	};

	const handlePush = () => {
		setPushedReviewRequest(null);
		pushBranch.reset();
		pushBranch.mutate();
	};

	const openGitSettings = () => navigate({ to: '/settings/git' });

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

	const toggleAllPaths = () => {
		const changedPaths = changedFileList.map((file) => file.path);
		setSelectedPaths((current) => {
			const allSelected = changedPaths.length > 0 && changedPaths.every((path) => current.has(path));
			return allSelected ? new Set() : new Set(changedPaths);
		});
	};

	const selectedChangedPaths = changedFileList
		.filter((file) => selectedPaths.has(file.path))
		.map((file) => file.path);
	const commitPending = commitChanges.isPending || createBranchAndCommit.isPending;
	const commitError = commitChanges.error?.message ?? createBranchAndCommit.error?.message;
	const branchChangeDisabled =
		changedFiles.isLoading ||
		changedFiles.isError ||
		hasUncommittedChanges ||
		hasUnsavedFileChanges ||
		switchBranch.isPending ||
		createBranch.isPending ||
		commitPending;
	const branchChangeReason = hasUnsavedFileChanges
		? 'Save or discard the open file before changing branches.'
		: changedFiles.isLoading
			? 'Checking for uncommitted changes before changing branches.'
			: changedFiles.isError
				? 'Reload changed files before changing branches.'
				: hasUncommittedChanges
					? 'Commit or discard changes before switching branches.'
					: null;
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
	const reviewRequest = pushedReviewRequest ?? openReviewRequest;
	const reviewRequestUrl = reviewRequest?.url ?? null;
	const reviewRequestNumber = reviewRequestUrl ? getReviewRequestNumber(reviewRequestUrl) : null;
	const reviewRequestAbbreviation = repo?.platform === 'gitlab' ? 'MR' : 'PR';
	const reviewRequestName = repo?.platform === 'gitlab' ? 'merge request' : 'pull request';
	const reviewRequestLabel =
		reviewRequest?.kind === 'link'
			? `Open ${reviewRequestAbbreviation}`
			: reviewRequestNumber
				? `#${reviewRequestNumber}`
				: reviewRequestAbbreviation;
	const reviewRequestTitle =
		reviewRequest?.kind === 'link'
			? reviewRequest.apiRefused
				? `Open ${reviewRequestAbbreviation}. The git token cannot open ${reviewRequestName}s, so you can open it yourself.`
				: `Open ${reviewRequestAbbreviation}`
			: `View ${reviewRequestName}${reviewRequestNumber ? ` #${reviewRequestNumber}` : ''}`;
	const discardDisabledReason = hasUnsavedFileChanges
		? 'Save or discard the open file before discarding saved changes.'
		: null;
	const handleOpenReviewRequest = () => {
		if (reviewRequestUrl) {
			window.open(reviewRequestUrl, '_blank', 'noopener,noreferrer');
		}
	};

	return (
		<div className='max-h-[65%] shrink-0 overflow-auto border-t'>
			<Expandable
				title={
					<span className='flex items-center gap-2'>
						<GitBranch className='size-3.5' />
						Git
					</span>
				}
				trailingContent={
					<div className='flex min-w-0 max-w-[80%] shrink-0 items-center gap-2'>
						{isGitAvailable && branches && (
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
						)}
						<ChangedFilesSummary files={changedFileList} />
					</div>
				}
				expanded={isOpen}
				onExpandedChange={setIsOpen}
				variant='plain'
				isLoading={repositoryStatus.isLoading || changedFiles.isLoading}
			>
				<div className='flex max-h-[min(38rem,65vh)] min-h-0 flex-col gap-3 overflow-y-auto px-2 py-2'>
					{switchBranch.error && (
						<div className='px-2'>
							<ErrorMessage message={switchBranch.error.message} />
						</div>
					)}
					{repositoryStatus.isLoading ? (
						<div className='flex items-center justify-center px-2 py-6'>
							<Spinner />
						</div>
					) : repositoryStatus.isError ? (
						<div className='flex flex-col gap-2 px-2'>
							<ErrorMessage
								message={repositoryStatus.error.message || 'Failed to load repository status'}
							/>
							<Button variant='outline' size='sm' onClick={() => repositoryStatus.refetch()}>
								Retry
							</Button>
						</div>
					) : !isGitAvailable ? (
						<div className='px-2'>
							<UnavailableGit
								message={
									status?.gitUnavailableMessage ?? 'Git actions are unavailable for this project.'
								}
								onSetup={openGitSettings}
							/>
						</div>
					) : (
						<>
							<ChangedFiles
								files={changedFileList}
								selectedPaths={selectedPaths}
								selectedDiffPath={selectedDiffPath}
								actionsDisabledReason={discardDisabledReason}
								isLoading={changedFiles.isLoading}
								error={changedFiles.error?.message}
								onRetry={() => changedFiles.refetch()}
								onViewDiff={onViewDiff}
								onToggle={togglePath}
								onToggleAll={toggleAllPaths}
								onDiscard={(file) => {
									discardChange.reset();
									setDiscardFile(file);
								}}
								onDiscardAll={() => {
									discardAllChanges.reset();
									setIsDiscardAllOpen(true);
								}}
							/>

							{hasUncommittedChanges && (
								<div className='-mx-2 space-y-3 border-t px-2 pt-3'>
									<div className='space-y-1.5'>
										<div className='flex min-w-0 items-center gap-2'>
											<Input
												value={commitMessage}
												onChange={(event) => setCommitMessage(event.target.value)}
												placeholder='Describe the context change'
												aria-label='Commit message'
												disabled={commitPending}
												className='h-7 min-w-0 flex-1 text-[11px] md:text-[11px]'
											/>
											<Button
												size='sm'
												className='h-7 px-2 text-[11px]'
												disabled={!canCommit || commitPending}
												isLoading={commitPending}
												onClick={handleCommit}
											>
												Commit
											</Button>
										</div>
										{currentBranch === defaultBranch && commitBranchName && (
											<div className='flex min-w-0 items-center gap-1 pl-[13px]'>
												<p
													className='min-w-0 truncate text-[11px] text-muted-foreground'
													title={commitBranchName}
												>
													Creates branch <span className='font-mono'>{commitBranchName}</span>
												</p>
												<Button
													variant='ghost-muted'
													size='icon-sm'
													className='shrink-0'
													aria-label='Edit branch name'
													disabled={createBranch.isPending || commitPending}
													onClick={() => {
														createBranch.reset();
														setNewBranchName(commitBranchName);
														setIsCreateBranchOpen(true);
													}}
												>
													<Pencil className='size-3.5' />
												</Button>
											</div>
										)}
									</div>
									{commitError && <ErrorMessage message={commitError} />}
									{fallbackBaseNotice && (
										<p className='text-xs text-amber-700 dark:text-amber-400'>
											This branch started from the current version and may need updating before
											review.
										</p>
									)}
								</div>
							)}
							<div className='-mx-2 space-y-2 border-t px-2 pt-2'>
								<div className='flex min-w-0 items-center justify-between gap-2'>
									<span className='min-w-0 flex-1 truncate pl-[13px] text-[11px] text-muted-foreground'>
										{canPush
											? 'Send committed changes'
											: reviewRequestUrl
												? 'Everything is pushed'
												: 'Nothing to push'}
									</span>
									<div className='flex shrink-0 items-center gap-1'>
										{reviewRequestUrl && (
											<Button
												variant='ghost-muted'
												size='sm'
												className='h-6 gap-1 px-1.5 text-[11px]'
												aria-label={reviewRequestTitle}
												onClick={handleOpenReviewRequest}
											>
												<GitPullRequest className='size-3' />
												{reviewRequestLabel}
											</Button>
										)}
										<Button
											variant='secondary'
											size='sm'
											className='h-6 gap-1 px-1.5 text-[11px]'
											aria-label='Push commits'
											disabled={!canPush || commitPending || pushBranch.isPending}
											isLoading={pushBranch.isPending}
											onClick={handlePush}
										>
											<ArrowUp className='size-3' />
											push
										</Button>
									</div>
								</div>
								{!hasUncommittedChanges && fallbackBaseNotice && (
									<p className='text-xs text-amber-700 dark:text-amber-400'>
										This branch started from the current version and may need updating before
										review.
									</p>
								)}
								{reviewRequest?.kind === 'link' && reviewRequest.apiRefused && (
									<p className='text-xs text-amber-700 dark:text-amber-400'>
										Branch pushed. The git provider could not create the {reviewRequestName}{' '}
										automatically — click Open {reviewRequestAbbreviation} to finish.
									</p>
								)}
								{pushBranch.error && <ErrorMessage message={pushBranch.error.message} />}
							</div>
						</>
					)}
				</div>
			</Expandable>

			<CreateBranchDialog
				open={isCreateBranchOpen}
				branchName={newBranchName}
				isPending={createBranch.isPending}
				error={createBranch.error?.message}
				onBranchNameChange={setNewBranchName}
				onOpenChange={setIsCreateBranchOpen}
				onCreate={() => createBranch.mutate({ branch: newBranchName.trim() })}
			/>
			<ConfirmationDialog
				open={discardFile !== null}
				title={getSingleDiscardTitle(discardFile)}
				description='Are you sure you want to discard the uncommitted changes to this file?'
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
				description={getDiscardAllDescription(changedFileList.length)}
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

function ChangedFilesSummary({ files }: { files: ContextChangedFile[] }) {
	if (files.length === 0) {
		return null;
	}
	let additions = 0;
	let deletions = 0;
	let hasKnownCounts = false;
	let hasUnknownCounts = false;
	for (const file of files) {
		if (file.additions === null || file.deletions === null) {
			hasUnknownCounts = true;
			continue;
		}
		additions += file.additions;
		deletions += file.deletions;
		hasKnownCounts = true;
	}
	return (
		<LineChangeSummary
			additions={hasKnownCounts ? additions : null}
			deletions={hasKnownCounts ? deletions : null}
			hasUnknownCounts={hasUnknownCounts}
		/>
	);
}

function LineChangeSummary({
	additions,
	deletions,
	hasUnknownCounts = additions === null || deletions === null,
}: {
	additions: number | null;
	deletions: number | null;
	hasUnknownCounts?: boolean;
}) {
	const hasKnownCounts = additions !== null && deletions !== null;
	const label = hasKnownCounts
		? `${additions} additions, ${deletions} deletions${hasUnknownCounts ? ', some line counts unavailable' : ''}`
		: 'Line counts unavailable';
	return (
		<span
			className='flex shrink-0 items-center gap-1.5 font-mono text-xs'
			aria-label={label}
			title={hasUnknownCounts ? 'Some line counts are unavailable.' : undefined}
		>
			{hasKnownCounts ? (
				<>
					<span className='text-emerald-600 dark:text-emerald-400' aria-hidden='true'>
						+{additions}
					</span>
					<span className='text-red-600 dark:text-red-400' aria-hidden='true'>
						−{deletions}
					</span>
					{hasUnknownCounts && (
						<span className='text-muted-foreground' aria-hidden='true'>
							?
						</span>
					)}
				</>
			) : (
				<span className='text-muted-foreground' aria-hidden='true'>
					±?
				</span>
			)}
		</span>
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
		<div
			className='min-w-0 max-w-48 flex-[0_1_auto]'
			onClick={(event) => {
				event.stopPropagation();
			}}
		>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant='ghost-muted'
						size='sm'
						className='min-w-0 max-w-full justify-start gap-1 px-2 text-xs font-normal'
						aria-label='Current repository branch'
					>
						<span className='truncate'>{currentBranch ?? 'Choose branch'}</span>
						<ChevronDown className='ml-auto size-3.5 shrink-0 text-muted-foreground' />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end' sideOffset={0} className='w-64 max-w-[calc(100vw-2rem)]'>
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
		</div>
	);
}

function ChangedFiles({
	files,
	selectedPaths,
	selectedDiffPath,
	actionsDisabledReason,
	isLoading,
	error,
	onRetry,
	onViewDiff,
	onToggle,
	onToggleAll,
	onDiscard,
	onDiscardAll,
}: {
	files: ContextChangedFile[];
	selectedPaths: Set<string>;
	selectedDiffPath: string | null;
	actionsDisabledReason: string | null;
	isLoading: boolean;
	error: string | undefined;
	onRetry: () => void;
	onViewDiff: (path: string) => void;
	onToggle: (path: string) => void;
	onToggleAll: () => void;
	onDiscard: (file: ContextChangedFile) => void;
	onDiscardAll: () => void;
}) {
	const allSelected = files.length > 0 && files.every((file) => selectedPaths.has(file.path));

	return (
		<section aria-label='Changed files' className='space-y-1'>
			{files.length > 0 && (
				<div className='flex min-w-0 items-center justify-between gap-1 px-2'>
					<Button
						variant='ghost-muted'
						size='sm'
						className='-ml-2 min-w-0 shrink px-2 text-xs font-normal focus-visible:ring-ring/50 focus-visible:ring-[3px]'
						onClick={onToggleAll}
					>
						<span className='truncate'>{allSelected ? 'Select None' : 'Select All'}</span>
					</Button>
					<Button
						variant='ghost-muted'
						size='sm'
						className='-mr-2 px-2 text-xs font-normal enabled:hover:text-destructive focus-visible:text-destructive focus-visible:ring-ring/50 focus-visible:ring-[3px]'
						disabled={actionsDisabledReason !== null}
						onClick={onDiscardAll}
					>
						Discard all
					</Button>
				</div>
			)}
			{files.length > 0 && actionsDisabledReason && (
				<p className='px-2 text-xs text-muted-foreground'>{actionsDisabledReason}</p>
			)}
			{isLoading ? (
				<div className='flex items-center justify-center px-2 py-5'>
					<Spinner />
				</div>
			) : error ? (
				<div className='flex flex-col gap-2 px-2'>
					<ErrorMessage message={error} />
					<Button variant='outline' size='sm' onClick={onRetry}>
						Retry
					</Button>
				</div>
			) : files.length === 0 ? (
				<p className='py-1 pr-2 pl-[13px] text-[11px] text-muted-foreground'>Nothing to commit</p>
			) : (
				<div className='max-h-48 overflow-y-auto'>
					{files.map((file) => (
						<ChangedFileRow
							key={file.path}
							file={file}
							isSelected={selectedPaths.has(file.path)}
							isViewing={selectedDiffPath === file.path}
							discardDisabled={actionsDisabledReason !== null}
							onView={() => onViewDiff(file.path)}
							onToggle={() => onToggle(file.path)}
							onDiscard={() => onDiscard(file)}
						/>
					))}
				</div>
			)}
		</section>
	);
}

function ChangedFileRow({
	file,
	isSelected,
	isViewing,
	discardDisabled,
	onView,
	onToggle,
	onDiscard,
}: {
	file: ContextChangedFile;
	isSelected: boolean;
	isViewing: boolean;
	discardDisabled: boolean;
	onView: () => void;
	onToggle: () => void;
	onDiscard: () => void;
}) {
	const fileName = file.path.split('/').pop() ?? file.path;
	const change = getChangeDisplay(file.kind);
	const ChangeIcon = change.icon;

	return (
		<div
			className={cn(
				'flex min-w-0 items-center gap-1.5 rounded-md px-2 py-0.5 transition-colors hover:bg-muted/40',
				isViewing && 'bg-muted/50',
			)}
		>
			<Checkbox
				className='cursor-pointer'
				checked={isSelected}
				onCheckedChange={onToggle}
				aria-label={`${isSelected ? 'Exclude' : 'Include'} ${fileName} in commit`}
			/>
			<button
				type='button'
				onClick={onView}
				aria-label={`View changes to ${fileName}`}
				title={file.path}
				className='flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm py-1 text-left outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]'
			>
				<ChangeIcon className={cn('size-3 shrink-0', change.color)} />
				<span className='min-w-0 flex-1 truncate text-xs'>{fileName}</span>
				<LineChangeSummary additions={file.additions} deletions={file.deletions} />
				<span className='sr-only'>{change.label}</span>
			</button>
			<Button
				variant='ghost-no-hover'
				size='icon-sm'
				className='enabled:hover:[&_svg]:text-destructive focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:[&_svg]:text-destructive'
				aria-label={`Discard changes to ${fileName}`}
				disabled={discardDisabled}
				onClick={onDiscard}
			>
				<X className='text-muted-foreground transition-colors' />
			</Button>
		</div>
	);
}

function UnavailableGit({ message, onSetup }: { message: string; onSetup: () => void }) {
	return (
		<div className='flex flex-col gap-3'>
			<p className='text-xs text-muted-foreground'>{message}</p>
			<Button variant='secondary' size='sm' className='w-fit' onClick={onSetup}>
				Set up git
			</Button>
		</div>
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

function getSingleDiscardTitle(file: ContextChangedFile | null): string {
	if (!file) {
		return 'Discard changes?';
	}
	const fileName = file.path.split('/').pop() ?? file.path;
	return `Discard ${fileName}?`;
}

function getDiscardAllDescription(changeCount: number): string {
	const fileCount = `${changeCount} ${changeCount === 1 ? 'file' : 'files'}`;
	return `Are you sure you want to discard the uncommitted changes across ${fileCount}?`;
}

function getReviewRequestNumber(url: string): string | null {
	return url.match(/\/(?:pull|pull-requests|merge_requests)\/(\d+)\/?(?:[?#].*)?$/)?.[1] ?? null;
}

function getChangeDisplay(kind: ContextChangedFile['kind']) {
	if (kind === 'untracked') {
		return { icon: FilePlus, label: 'New', color: 'text-emerald-500' };
	}
	if (kind === 'deleted') {
		return { icon: FileX, label: 'Removed', color: 'text-red-500' };
	}
	return { icon: FilePen, label: 'Edited', color: 'text-amber-500' };
}

async function invalidateExplorerQueries(queryClient: QueryClient): Promise<void> {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getRepositoryStatus.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getChangedFiles.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.suggestBranchName.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getFileTree.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.readFile.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getFileDiff.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.searchContent.queryKey() }),
	]);
}

function areSetsEqual(left: Set<string>, right: Set<string>): boolean {
	return left.size === right.size && [...left].every((value) => right.has(value));
}
