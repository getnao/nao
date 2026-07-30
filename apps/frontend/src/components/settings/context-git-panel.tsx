import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Check, ExternalLink, FilePen, FilePlus, FileX, GitBranch, Plus, Trash2 } from 'lucide-react';
import type { QueryClient } from '@tanstack/react-query';
import type { ContextChangedFile } from '@nao/shared/types';

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { ErrorMessage } from '@/components/ui/error-message';
import { Expandable } from '@/components/ui/expandable';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useSidebarSectionOpen } from '@/hooks/use-sidebar-section-open';
import { useSession } from '@/lib/auth-client';
import { getTimeAgo } from '@/lib/time-ago';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

type ContextRepo = {
	provider: 'github' | 'gitlab';
	repoFullName: string;
	branch: string | null;
};

type OpenPullRequest = {
	url: string;
	branch: string;
	openedAt: number;
};

interface ContextGitPanelProps {
	selectedDiffPath: string | null;
	hasUnsavedFileChanges: boolean;
	onViewDiff: (path: string) => void;
	onDiscarded: (path: string) => Promise<void>;
	onDiscardAll: () => Promise<void>;
	onRepositoryChanged: () => void;
}

export function ContextGitPanel({
	selectedDiffPath,
	hasUnsavedFileChanges,
	onViewDiff,
	onDiscarded,
	onDiscardAll,
	onRepositoryChanged,
}: ContextGitPanelProps) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { data: session, isPending: isSessionPending } = useSession();
	const { isOpen, setIsOpen } = useSidebarSectionOpen('context-explorer-git');
	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
	const [discardFile, setDiscardFile] = useState<ContextChangedFile | null>(null);
	const [isDiscardAllOpen, setIsDiscardAllOpen] = useState(false);
	const [isCreateBranchOpen, setIsCreateBranchOpen] = useState(false);
	const [newBranchName, setNewBranchName] = useState('');
	const [commitMessage, setCommitMessage] = useState('');
	const [commitBranchName, setCommitBranchName] = useState('');
	const [isCommitBranchTouched, setIsCommitBranchTouched] = useState(false);
	const [pullRequestTitle, setPullRequestTitle] = useState('');
	const [pullRequestBody, setPullRequestBody] = useState('');
	const [commitConfirmation, setCommitConfirmation] = useState<string | null>(null);
	const [fallbackBaseNotice, setFallbackBaseNotice] = useState(false);
	const [pullRequest, setPullRequest] = useState<OpenPullRequest | null>(null);
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
		if (!branches || currentBranch !== defaultBranch || isCommitBranchTouched) {
			return;
		}
		setCommitBranchName(suggestedBranchName.data ?? branches.suggestedBranch);
	}, [branches, currentBranch, defaultBranch, isCommitBranchTouched, suggestedBranchName.data]);

	useEffect(() => {
		setIsCommitBranchTouched(false);
	}, [currentBranch]);

	useEffect(() => {
		setPullRequest(readBrowserPullRequest(repo, currentBranch));
	}, [currentBranch, repo]);

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
			onSuccess: async () => {
				setIsCreateBranchOpen(false);
				setNewBranchName('');
				await refreshExplorer(true);
			},
		}),
	);

	const commitChanges = useMutation(
		trpc.contextExplorer.commitChanges.mutationOptions({
			onSuccess: async (result, variables) => {
				handleCommitSuccess(variables.paths, currentBranch, result.commit, false);
				await refreshExplorer(false);
			},
		}),
	);

	const createBranchAndCommit = useMutation(
		trpc.contextExplorer.createBranchAndCommit.mutationOptions({
			onSuccess: async (result, variables) => {
				handleCommitSuccess(variables.paths, result.branch, result.commit, result.usedFallbackBase);
				await refreshExplorer(false);
			},
		}),
	);

	const createPullRequest = useMutation(
		trpc.contextExplorer.createPullRequest.mutationOptions({
			onSuccess: async (result) => {
				const openedPullRequest = { url: result.url, branch: result.branch, openedAt: Date.now() };
				setPullRequest(openedPullRequest);
				writeBrowserPullRequest(repo, result.branch, openedPullRequest);
				setCommitMessage('');
				setSelectedPaths(new Set());
				setFallbackBaseNotice(result.usedFallbackBase);
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

	const handleCommitSuccess = (paths: string[], branch: string | null, commit: string, usedFallbackBase: boolean) => {
		if (!branch) {
			return;
		}
		setCommitMessage('');
		setSelectedPaths(new Set());
		setCommitConfirmation(
			`Committed ${paths.length} ${paths.length === 1 ? 'file' : 'files'} (${commit.slice(0, 7)}).`,
		);
		setFallbackBaseNotice(usedFallbackBase);
		setPullRequestTitle(commitMessage.trim());
	};

	const handleCommit = () => {
		const paths = changedFileList.filter((file) => selectedPaths.has(file.path)).map((file) => file.path);
		const message = commitMessage.trim();
		if (!message || paths.length === 0 || !currentBranch || !defaultBranch) {
			return;
		}
		setCommitConfirmation(null);
		setFallbackBaseNotice(false);
		commitChanges.reset();
		createBranchAndCommit.reset();
		if (currentBranch === defaultBranch) {
			createBranchAndCommit.mutate({
				branch: commitBranchName.trim() || undefined,
				paths,
				message,
			});
			return;
		}
		commitChanges.mutate({ paths, message });
	};

	const handlePropose = () => {
		const title = pullRequestTitle.trim();
		const message = commitMessage.trim();
		if (!title || !message || selectedChangedPaths.length === 0) {
			return;
		}
		createPullRequest.mutate({
			paths: selectedChangedPaths,
			message,
			title,
			body: pullRequestBody.trim() || undefined,
		});
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
		defaultBranch !== null &&
		(currentBranch !== defaultBranch || commitBranchName.trim().length > 0);
	const canPropose =
		selectedChangedPaths.length > 0 &&
		commitMessage.trim().length > 0 &&
		pullRequestTitle.trim().length > 0 &&
		currentBranch !== null &&
		defaultBranch !== null;
	const proposeDisabledReason =
		selectedChangedPaths.length === 0
			? 'Select at least one changed file.'
			: commitMessage.trim().length === 0
				? 'Add a commit message above.'
				: pullRequestTitle.trim().length === 0
					? 'Add a pull request title.'
					: null;
	const otherEditors = getOtherEditorNames(changedFileList, session?.user?.id);
	const discardDisabledReason = hasUnsavedFileChanges
		? 'Save or discard the open file before discarding saved changes.'
		: isSessionPending
			? 'Waiting for your account details before discarding shared changes.'
			: null;

	return (
		<div className='max-h-[65%] shrink-0 overflow-auto border-t bg-card p-2'>
			<Expandable
				title={
					<span className='flex items-center gap-2'>
						<GitBranch className='size-3.5' />
						Git
					</span>
				}
				badge={changedFileList.length}
				expanded={isOpen}
				onExpandedChange={setIsOpen}
				variant='bordered'
				isLoading={repositoryStatus.isLoading || changedFiles.isLoading}
			>
				<div className='flex max-h-[min(38rem,65vh)] min-h-0 flex-col gap-3 overflow-y-auto p-2'>
					<p className='text-xs text-muted-foreground'>
						Changes are not live for other users or the agent until the pull request is merged and deployed.
					</p>
					<p className='text-xs text-muted-foreground'>
						This review workspace is shared with other context admins.
					</p>

					{repositoryStatus.isLoading ? (
						<div className='flex items-center justify-center py-6'>
							<Spinner />
						</div>
					) : repositoryStatus.isError ? (
						<div className='flex flex-col gap-2'>
							<ErrorMessage
								message={repositoryStatus.error.message || 'Failed to load repository status'}
							/>
							<Button variant='outline' size='sm' onClick={() => repositoryStatus.refetch()}>
								Retry
							</Button>
						</div>
					) : !isGitAvailable ? (
						<UnavailableGit
							message={status?.gitUnavailableMessage ?? 'Git actions are unavailable for this project.'}
							onSetup={openGitSettings}
						/>
					) : (
						<>
							<BranchSelector
								branches={branches.branches}
								currentBranch={currentBranch}
								defaultBranch={branches.defaultBranch}
								disabled={branchChangeDisabled}
								reason={branchChangeReason}
								error={switchBranch.error?.message}
								onSwitch={(branch) => {
									if (branch !== currentBranch) {
										switchBranch.mutate({ branch });
									}
								}}
								onCreate={() => {
									createBranch.reset();
									setIsCreateBranchOpen(true);
								}}
								onSetup={openGitSettings}
							/>

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
								onDiscard={(file) => {
									discardChange.reset();
									setDiscardFile(file);
								}}
								onDiscardAll={() => {
									discardAllChanges.reset();
									setIsDiscardAllOpen(true);
								}}
							/>

							<CommitForm
								isDefaultBranch={currentBranch === defaultBranch}
								branchName={commitBranchName}
								message={commitMessage}
								selectedCount={selectedChangedPaths.length}
								isPending={commitPending}
								canCommit={canCommit}
								error={commitError}
								confirmation={commitConfirmation}
								fallbackBaseNotice={fallbackBaseNotice}
								onBranchNameChange={(value) => {
									setIsCommitBranchTouched(true);
									setCommitBranchName(value);
								}}
								onMessageChange={setCommitMessage}
								onCommit={handleCommit}
							/>

							<ProposeForm
								title={pullRequestTitle}
								body={pullRequestBody}
								pullRequest={pullRequest}
								isPending={createPullRequest.isPending}
								canPropose={canPropose}
								disabledReason={proposeDisabledReason}
								error={createPullRequest.error?.message}
								onTitleChange={setPullRequestTitle}
								onBodyChange={setPullRequestBody}
								onPropose={handlePropose}
							/>
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
			<DiscardDialog
				open={discardFile !== null}
				title='Discard changes to this file?'
				description={getSingleDiscardDescription(discardFile, session?.user?.id)}
				confirmLabel='Discard changes'
				isPending={discardChange.isPending}
				error={discardChange.error?.message}
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
			<DiscardDialog
				open={isDiscardAllOpen}
				title='Discard all changes?'
				description={getDiscardAllDescription(changedFileList.length, otherEditors)}
				confirmLabel='Discard all changes'
				isPending={discardAllChanges.isPending}
				error={discardAllChanges.error?.message}
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

function BranchSelector({
	branches,
	currentBranch,
	defaultBranch,
	disabled,
	reason,
	error,
	onSwitch,
	onCreate,
	onSetup,
}: {
	branches: string[];
	currentBranch: string | null;
	defaultBranch: string;
	disabled: boolean;
	reason: string | null;
	error: string | undefined;
	onSwitch: (branch: string) => void;
	onCreate: () => void;
	onSetup: () => void;
}) {
	return (
		<section className='rounded-md border p-2'>
			<div className='flex items-center gap-2'>
				<Select value={currentBranch ?? undefined} onValueChange={onSwitch} disabled={disabled}>
					<SelectTrigger size='sm' className='min-w-0 flex-1' aria-label='Current repository branch'>
						<SelectValue placeholder='Choose branch' />
					</SelectTrigger>
					<SelectContent>
						{branches.map((branch) => (
							<SelectItem key={branch} value={branch}>
								{branch}
								{branch === defaultBranch ? ' (default)' : ''}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button variant='outline' size='sm' disabled={disabled} onClick={onCreate}>
					<Plus className='size-3.5' />
					New
				</Button>
				<Button variant='ghost' size='sm' onClick={onSetup}>
					Setup
				</Button>
			</div>
			{reason && <p className='mt-1.5 text-xs text-muted-foreground'>{reason}</p>}
			{error && <ErrorMessage message={error} />}
		</section>
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
	onDiscard: (file: ContextChangedFile) => void;
	onDiscardAll: () => void;
}) {
	return (
		<section className='rounded-md border'>
			<div className='flex items-center justify-between border-b px-2 py-1.5'>
				<span className='text-xs font-medium'>Changed files</span>
				<Button
					variant='destructive'
					size='sm'
					disabled={files.length === 0 || actionsDisabledReason !== null}
					onClick={onDiscardAll}
				>
					<Trash2 className='size-3.5' />
					Discard all
				</Button>
			</div>
			{actionsDisabledReason && (
				<p className='border-b px-2 py-1.5 text-xs text-muted-foreground'>{actionsDisabledReason}</p>
			)}
			{isLoading ? (
				<div className='flex items-center justify-center py-5'>
					<Spinner />
				</div>
			) : error ? (
				<div className='flex flex-col gap-2 p-2'>
					<ErrorMessage message={error} />
					<Button variant='outline' size='sm' onClick={onRetry}>
						Retry
					</Button>
				</div>
			) : files.length === 0 ? (
				<p className='p-2 text-xs text-muted-foreground'>No uncommitted changes.</p>
			) : (
				<div className='max-h-44 overflow-y-auto p-1'>
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
	const folder = file.path.slice(0, file.path.lastIndexOf('/')) || 'Project root';
	const change = getChangeDisplay(file.kind);
	const ChangeIcon = change.icon;
	const editorMetadata = getEditorMetadata(file);

	return (
		<div className={cn('flex items-center rounded-md', isViewing && 'bg-muted')}>
			<button
				type='button'
				onClick={onToggle}
				aria-pressed={isSelected}
				aria-label={`${isSelected ? 'Exclude' : 'Include'} ${fileName} in commit`}
				className={cn(
					'ml-1 flex size-5 shrink-0 items-center justify-center rounded border',
					isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/30',
				)}
			>
				{isSelected && <Check className='size-3' />}
			</button>
			<button
				type='button'
				onClick={onView}
				className='flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/60'
			>
				<ChangeIcon className={cn('size-3.5 shrink-0', change.color)} />
				<span className='min-w-0 flex-1'>
					<span className='block truncate text-xs font-medium'>{fileName}</span>
					<span className='block truncate text-[10px] text-muted-foreground'>{folder}</span>
					{editorMetadata && (
						<span className='block truncate text-[10px] text-muted-foreground'>{editorMetadata}</span>
					)}
				</span>
				<span className='shrink-0 text-[10px] text-muted-foreground'>{change.label}</span>
			</button>
			<Button
				variant='destructive'
				size='sm'
				className='mr-1 px-2'
				aria-label={`Discard changes to ${fileName}`}
				disabled={discardDisabled}
				onClick={onDiscard}
			>
				Discard
			</Button>
		</div>
	);
}

function CommitForm({
	isDefaultBranch,
	branchName,
	message,
	selectedCount,
	isPending,
	canCommit,
	error,
	confirmation,
	fallbackBaseNotice,
	onBranchNameChange,
	onMessageChange,
	onCommit,
}: {
	isDefaultBranch: boolean;
	branchName: string;
	message: string;
	selectedCount: number;
	isPending: boolean;
	canCommit: boolean;
	error: string | undefined;
	confirmation: string | null;
	fallbackBaseNotice: boolean;
	onBranchNameChange: (value: string) => void;
	onMessageChange: (value: string) => void;
	onCommit: () => void;
}) {
	return (
		<section className='flex flex-col gap-2 rounded-md border p-2'>
			<div>
				<p className='text-xs font-medium'>Commit</p>
				<p className='text-[11px] text-muted-foreground'>Save the selected files to the current branch.</p>
			</div>
			{isDefaultBranch && (
				<label className='flex flex-col gap-1 text-xs'>
					New branch
					<Input
						value={branchName}
						onChange={(event) => onBranchNameChange(event.target.value)}
						placeholder='nao/context-edits-…'
						disabled={isPending}
						className='h-8 text-xs'
					/>
				</label>
			)}
			<label className='flex flex-col gap-1 text-xs'>
				Commit message
				<Input
					value={message}
					onChange={(event) => onMessageChange(event.target.value)}
					placeholder='Describe the context change'
					disabled={isPending}
					className='h-8 text-xs'
				/>
			</label>
			{error && <ErrorMessage message={error} />}
			{confirmation && <p className='text-xs text-emerald-600 dark:text-emerald-400'>{confirmation}</p>}
			{fallbackBaseNotice && (
				<p className='text-xs text-amber-700 dark:text-amber-400'>
					This branch started from the current version and may need updating before review.
				</p>
			)}
			<Button size='sm' disabled={!canCommit || isPending} isLoading={isPending} onClick={onCommit}>
				Commit {selectedCount > 0 ? `${selectedCount} ${selectedCount === 1 ? 'file' : 'files'}` : 'files'}
			</Button>
		</section>
	);
}

function ProposeForm({
	title,
	body,
	pullRequest,
	isPending,
	canPropose,
	disabledReason,
	error,
	onTitleChange,
	onBodyChange,
	onPropose,
}: {
	title: string;
	body: string;
	pullRequest: OpenPullRequest | null;
	isPending: boolean;
	canPropose: boolean;
	disabledReason: string | null;
	error: string | undefined;
	onTitleChange: (value: string) => void;
	onBodyChange: (value: string) => void;
	onPropose: () => void;
}) {
	return (
		<section className='flex flex-col gap-2 rounded-md border p-2'>
			<div>
				<p className='text-xs font-medium'>Propose changes</p>
				<p className='text-[11px] text-muted-foreground'>Open a pull request for review.</p>
			</div>
			{pullRequest && (
				<div className='rounded-md bg-primary/5 p-2'>
					<a
						href={pullRequest.url}
						target='_blank'
						rel='noreferrer'
						className='flex items-center gap-1 text-sm font-medium text-primary hover:underline'
					>
						Open pull request
						<ExternalLink className='size-3.5' />
					</a>
					<p className='mt-1 text-[10px] text-muted-foreground'>
						This is the last pull request opened from this browser and may not reflect its current status.
					</p>
				</div>
			)}
			<label className='flex flex-col gap-1 text-xs'>
				Title
				<Input
					value={title}
					onChange={(event) => onTitleChange(event.target.value)}
					placeholder='Describe the proposed change'
					disabled={isPending}
					className='h-8 text-xs'
				/>
			</label>
			<label className='flex flex-col gap-1 text-xs'>
				Description <span className='text-muted-foreground'>(optional)</span>
				<Textarea
					value={body}
					onChange={(event) => onBodyChange(event.target.value)}
					placeholder='Add context for reviewers'
					disabled={isPending}
					className='min-h-16 text-xs'
				/>
			</label>
			{disabledReason && <p className='text-xs text-muted-foreground'>{disabledReason}</p>}
			{error && <ErrorMessage message={error} />}
			<Button size='sm' disabled={!canPropose || isPending} isLoading={isPending} onClick={onPropose}>
				Propose changes
			</Button>
		</section>
	);
}

function UnavailableGit({ message, onSetup }: { message: string; onSetup: () => void }) {
	return (
		<div className='flex flex-col gap-2 rounded-md border p-3'>
			<p className='text-xs text-muted-foreground'>{message}</p>
			<Button size='sm' className='w-fit' onClick={onSetup}>
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
				<label className='flex flex-col gap-1 text-sm'>
					Branch name
					<Input
						value={branchName}
						onChange={(event) => onBranchNameChange(event.target.value)}
						placeholder='nao/context-edits'
						autoFocus
					/>
				</label>
				{error && <ErrorMessage message={error} />}
				<DialogFooter>
					<Button variant='outline' disabled={isPending} onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button disabled={!branchName.trim() || isPending} isLoading={isPending} onClick={onCreate}>
						Create branch
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function DiscardDialog({
	open,
	title,
	description,
	confirmLabel,
	isPending,
	error,
	onOpenChange,
	onConfirm,
}: {
	open: boolean;
	title: string;
	description: string;
	confirmLabel: string;
	isPending: boolean;
	error: string | undefined;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				{error && <ErrorMessage message={error} />}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isPending}>Keep changes</AlertDialogCancel>
					<AlertDialogAction
						variant='destructive'
						isLoading={isPending}
						disabled={isPending}
						onClick={(event) => {
							event.preventDefault();
							onConfirm();
						}}
					>
						{confirmLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function getSingleDiscardDescription(file: ContextChangedFile | null, currentUserId: string | undefined): string {
	if (!file) {
		return '';
	}
	const fileName = file.path.split('/').pop() ?? file.path;
	const editor = file.lastEditor;
	if (editor && currentUserId && editor.id !== currentUserId) {
		return `This permanently discards changes to ${fileName}. These changes were last edited by ${editor.name}, not you. This cannot be undone.`;
	}
	return `This permanently discards all uncommitted changes to ${fileName}. This cannot be undone.`;
}

function getDiscardAllDescription(changeCount: number, otherEditors: string[]): string {
	const base = `This permanently discards all uncommitted changes to ${changeCount} ${changeCount === 1 ? 'file' : 'files'} in the shared workspace.`;
	if (otherEditors.length === 0) {
		return `${base} This cannot be undone.`;
	}
	return `${base} This includes changes last edited by ${formatNames(otherEditors)}, not you. This cannot be undone.`;
}

function getOtherEditorNames(files: ContextChangedFile[], currentUserId: string | undefined): string[] {
	if (!currentUserId) {
		return [];
	}
	return [
		...new Set(
			files
				.map((file) => file.lastEditor)
				.filter((editor) => editor && editor.id !== currentUserId)
				.map((editor) => editor?.name)
				.filter((name): name is string => name !== undefined),
		),
	];
}

function formatNames(names: string[]): string {
	if (names.length === 1) {
		return names[0];
	}
	if (names.length === 2) {
		return `${names[0]} and ${names[1]}`;
	}
	return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
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

function getEditorMetadata(file: ContextChangedFile): string | null {
	const editorName = file.lastEditor?.name;
	const editedAt = file.lastEditedAt ? getTimeAgo(file.lastEditedAt).humanReadable : null;
	if (editorName && editedAt) {
		return `Last edited by ${editorName} · ${editedAt}`;
	}
	if (editorName) {
		return `Last edited by ${editorName}`;
	}
	if (editedAt) {
		return `Last edited ${editedAt}`;
	}
	return null;
}

function readBrowserPullRequest(repo: ContextRepo | null, branch: string | null): OpenPullRequest | null {
	const key = getBrowserBranchStorageKey(repo, branch);
	if (!key) {
		return null;
	}
	try {
		const value = window.localStorage.getItem(key);
		if (!value) {
			return null;
		}
		const parsed = JSON.parse(value) as { pullRequest?: OpenPullRequest | null };
		return parsed.pullRequest ?? null;
	} catch {
		return null;
	}
}

function writeBrowserPullRequest(repo: ContextRepo | null, branch: string | null, pullRequest: OpenPullRequest): void {
	const key = getBrowserBranchStorageKey(repo, branch);
	if (key) {
		window.localStorage.setItem(key, JSON.stringify({ pullRequest }));
	}
}

function getBrowserBranchStorageKey(repo: ContextRepo | null, branch: string | null): string | null {
	if (!repo || !branch) {
		return null;
	}
	return `nao-context-explorer:${repo.provider}:${repo.repoFullName}:${branch}`;
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
