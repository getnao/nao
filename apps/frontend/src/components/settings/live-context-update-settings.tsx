import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';

import type { QueryClient } from '@tanstack/react-query';
import type { LiveContextRepository } from '@/lib/live-context-links';

import {
	ContextWorktreeUpdateDialog,
	isDirtyWorktreeConflict,
} from '@/components/settings/context-worktree-update-dialog';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { ErrorMessage } from '@/components/ui/error-message';
import { SettingsCard } from '@/components/ui/settings-card';
import {
	formatChangedFileCount,
	getHiddenPullFileCount,
	getVisiblePullFiles,
	hasHistoricalPullRange,
} from '@/lib/live-context-history';
import { buildCommitUrl } from '@/lib/live-context-links';
import { trpc } from '@/main';

interface LiveContextUpdateStatus {
	enabled: boolean;
	available: boolean;
	configuredBranch: string;
	unavailableReason: string | null;
	configurationError: string | null;
}

interface LiveContextUpdateSettingsProps {
	status: LiveContextUpdateStatus;
	repository: LiveContextRepository | null;
	isAdmin: boolean;
}

interface PullHistoryEntry {
	id: string;
	status: string;
	startedAt: Date;
	completedAt: Date | null;
	changed: boolean | null;
	oldCommit: string | null;
	newCommit: string | null;
	fileCount: number;
	files: Array<{ path: string; additions: number | null; deletions: number | null }>;
	errorMessage: string | null;
	fileExplorerAction: HistoricalDiffAction;
}

type HistoricalDiffAction = 'open' | 'switch' | 'update' | 'blocked';

export function LiveContextUpdateSettings({ status, repository, isAdmin }: LiveContextUpdateSettingsProps) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const [pendingHistoricalDiff, setPendingHistoricalDiff] = useState<{
		path: string;
		from: string;
		to: string;
	} | null>(null);
	const [historicalDiffError, setHistoricalDiffError] = useState<string | null>(null);
	const [isDirtyWorktreeDialogOpen, setIsDirtyWorktreeDialogOpen] = useState(false);
	const [isWorktreeUpdateBlocked, setIsWorktreeUpdateBlocked] = useState(false);
	const [isCheckingHistoricalDiff, setIsCheckingHistoricalDiff] = useState(false);
	const history = useQuery(trpc.contextExplorer.getLiveContextPullHistory.queryOptions());
	const pullContext = useMutation(
		trpc.contextExplorer.pullLiveContext.mutationOptions({
			onSettled: async () => {
				await invalidateContextQueries(queryClient);
			},
		}),
	);
	const updateWorktree = useMutation(trpc.contextExplorer.updateWorktree.mutationOptions());
	const latestRecordedError = history.data?.[0]?.status === 'failed' ? history.data[0].errorMessage : null;

	const navigateToHistoricalDiff = (input: { path: string; from: string; to: string }) => {
		queryClient.removeQueries({
			queryKey: trpc.contextExplorer.getFileDiff.queryKey(input),
			exact: true,
		});
		return navigate({
			to: '/settings/context-explorer',
			search: input,
		});
	};

	const openHistoricalDiff = async (input: { path: string; from: string; to: string }) => {
		setHistoricalDiffError(null);
		setIsCheckingHistoricalDiff(true);
		let action: HistoricalDiffAction;
		try {
			action = await queryClient.fetchQuery({
				...trpc.contextExplorer.getHistoricalDiffAction.queryOptions({
					from: input.from,
					to: input.to,
				}),
				staleTime: 0,
			});
		} catch (error) {
			setHistoricalDiffError(error instanceof Error ? error.message : 'This historical change is unavailable.');
			setIsCheckingHistoricalDiff(false);
			return;
		}
		setIsCheckingHistoricalDiff(false);
		if (action === 'open') {
			void navigateToHistoricalDiff(input);
		} else if (action === 'switch') {
			void switchAndOpenHistoricalDiff(input);
		} else if (action === 'blocked') {
			setIsDirtyWorktreeDialogOpen(true);
		} else {
			updateWorktree.reset();
			setIsWorktreeUpdateBlocked(false);
			setPendingHistoricalDiff(input);
		}
	};

	const switchAndOpenHistoricalDiff = async (input: { path: string; from: string; to: string }) => {
		updateWorktree.reset();
		try {
			await updateWorktree.mutateAsync({ requiredCommits: [input.from, input.to] });
			await navigateToHistoricalDiff(input);
			void invalidateContextQueries(queryClient);
		} catch (error) {
			if (isDirtyWorktreeConflict(error)) {
				setIsDirtyWorktreeDialogOpen(true);
				return;
			}
			setHistoricalDiffError(error instanceof Error ? error.message : 'Unable to open this historical change.');
		}
	};

	const confirmWorktreeUpdate = async () => {
		if (!pendingHistoricalDiff) {
			return;
		}
		try {
			await updateWorktree.mutateAsync({
				requiredCommits: [pendingHistoricalDiff.from, pendingHistoricalDiff.to],
			});
			const target = pendingHistoricalDiff;
			setPendingHistoricalDiff(null);
			setIsWorktreeUpdateBlocked(false);
			await navigateToHistoricalDiff(target);
			void invalidateContextQueries(queryClient);
		} catch (error) {
			if (isDirtyWorktreeConflict(error)) {
				setIsWorktreeUpdateBlocked(true);
			}
			return;
		}
	};

	return (
		<SettingsCard
			title='Update context files'
			icon={<RefreshCw className='size-4' />}
			description={`Pull the latest changes from ${status.configuredBranch}`}
			rootClassName='mt-5'
			action={
				<Button
					size='sm'
					variant='primary-gradient'
					isLoading={pullContext.isPending}
					disabled={!isAdmin || !status.available || pullContext.isPending}
					onClick={() => {
						pullContext.reset();
						pullContext.mutate();
					}}
				>
					Pull latest
				</Button>
			}
			className='gap-4'
		>
			{!isAdmin && (
				<p className='text-sm text-muted-foreground'>Only a project admin can update live context files.</p>
			)}
			{isAdmin && !status.available && status.unavailableReason && (
				<p className='text-sm text-muted-foreground'>{status.unavailableReason}</p>
			)}
			{pullContext.error && latestRecordedError !== pullContext.error.message && (
				<ErrorMessage message={pullContext.error.message} />
			)}
			{historicalDiffError && <ErrorMessage message={historicalDiffError} />}
			{history.isLoading ? (
				<p className='text-sm text-muted-foreground'>Loading pull history…</p>
			) : history.error ? (
				<ErrorMessage message={history.error.message} />
			) : history.data?.length === 0 ? (
				<p className='text-sm text-muted-foreground'>
					No pulls yet. Pull the latest version to check for updates.
				</p>
			) : (
				<div className='divide-y divide-border'>
					{history.data?.map((activity) => (
						<HistoryEntry
							key={activity.id}
							activity={activity}
							repository={repository}
							isOpeningHistoricalDiff={
								isCheckingHistoricalDiff ||
								pendingHistoricalDiff !== null ||
								isDirtyWorktreeDialogOpen ||
								updateWorktree.isPending
							}
							onOpenHistoricalDiff={openHistoricalDiff}
						/>
					))}
				</div>
			)}
			<ContextWorktreeUpdateDialog
				open={pendingHistoricalDiff !== null}
				branch={status.configuredBranch}
				isPending={updateWorktree.isPending}
				isBlocked={isWorktreeUpdateBlocked}
				error={updateWorktree.error?.message}
				onOpenChange={(open) => {
					if (!open && !updateWorktree.isPending) {
						setPendingHistoricalDiff(null);
						setIsWorktreeUpdateBlocked(false);
						updateWorktree.reset();
					}
				}}
				onConfirm={confirmWorktreeUpdate}
				onBlockedAction={() => navigate({ to: '/settings/context-explorer' })}
			/>
			<ConfirmationDialog
				open={isDirtyWorktreeDialogOpen}
				title='Finish your changes first'
				description='File Explorer has uncommitted changes. Commit or discard them before viewing these changes.'
				confirmLabel='Open File Explorer'
				confirmVariant='primary-gradient'
				onOpenChange={setIsDirtyWorktreeDialogOpen}
				onConfirm={() => {
					setIsDirtyWorktreeDialogOpen(false);
					void navigate({ to: '/settings/context-explorer' });
				}}
			/>
		</SettingsCard>
	);
}

function HistoryEntry({
	activity,
	repository,
	isOpeningHistoricalDiff,
	onOpenHistoricalDiff,
}: {
	activity: PullHistoryEntry;
	repository: LiveContextRepository | null;
	isOpeningHistoricalDiff: boolean;
	onOpenHistoricalDiff: (input: { path: string; from: string; to: string }) => Promise<void>;
}) {
	const [isExpanded, setIsExpanded] = useState(false);
	const timestamp = activity.completedAt ?? activity.startedAt;
	const hasCompletedDiff = activity.status === 'completed' && activity.changed !== null;

	return (
		<div className='py-3 first:pt-0 last:pb-0'>
			<div className='flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1'>
				<div className='flex min-w-0 items-center gap-1.5 text-sm font-medium'>
					<span>{getStatusText(activity)}</span>
					{hasCompletedDiff && activity.newCommit && (
						<CommitReference repository={repository} commit={activity.newCommit} />
					)}
				</div>
				<time dateTime={new Date(timestamp).toISOString()} className='text-xs text-muted-foreground'>
					{new Date(timestamp).toLocaleString()}
				</time>
			</div>
			{hasCompletedDiff && activity.fileCount > 0 ? (
				<p className='mt-2 text-xs text-muted-foreground'>{formatChangedFileCount(activity.fileCount)}</p>
			) : hasCompletedDiff ? (
				<div className='mt-2 h-4' aria-hidden='true' />
			) : null}
			{activity.status === 'failed' && activity.errorMessage && (
				<p className='mt-2 text-sm text-destructive'>{activity.errorMessage}</p>
			)}
			{hasCompletedDiff && activity.files.length > 0 && (
				<PullFileList
					files={activity.files}
					from={activity.oldCommit}
					to={activity.newCommit}
					isExpanded={isExpanded}
					onExpandedChange={setIsExpanded}
					isOpeningHistoricalDiff={isOpeningHistoricalDiff}
					onOpenHistoricalDiff={onOpenHistoricalDiff}
				/>
			)}
		</div>
	);
}

function getStatusText(activity: PullHistoryEntry): string {
	if (activity.status === 'failed') {
		return 'Pull failed';
	}
	if (activity.status === 'running') {
		return 'Pull in progress';
	}
	if (activity.status === 'cancelled') {
		return 'Pull cancelled';
	}
	if (activity.changed === null) {
		return 'Pull completed';
	}
	return activity.changed ? 'Pulled latest commit' : 'Already up to date';
}

function CommitReference({ repository, commit }: { repository: LiveContextRepository | null; commit: string }) {
	const shortCommit = commit.slice(0, 7);
	const url = repository ? buildCommitUrl(repository, commit) : null;
	const className = 'rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium leading-none text-foreground';
	if (!url) {
		return <span className={className}>{shortCommit}</span>;
	}
	return (
		<a
			href={url}
			target='_blank'
			rel='noreferrer'
			className={`${className} hover:underline`}
			aria-label={`View commit ${shortCommit}`}
		>
			{shortCommit}
		</a>
	);
}

function PullFileList({
	files,
	from,
	to,
	isExpanded,
	onExpandedChange,
	isOpeningHistoricalDiff,
	onOpenHistoricalDiff,
}: {
	files: Array<{ path: string; additions: number | null; deletions: number | null }>;
	from: string | null;
	to: string | null;
	isExpanded: boolean;
	onExpandedChange: (expanded: boolean) => void;
	isOpeningHistoricalDiff: boolean;
	onOpenHistoricalDiff: (input: { path: string; from: string; to: string }) => Promise<void>;
}) {
	const visibleFiles = getVisiblePullFiles(files, isExpanded);
	const hiddenFileCount = getHiddenPullFileCount(files.length);

	return (
		<div className='mt-2'>
			<ul className='space-y-1 text-sm'>
				{visibleFiles.map((file) => (
					<li key={file.path} className='flex min-w-0 items-center justify-between gap-4'>
						{hasHistoricalPullRange(from, to) && from && to ? (
							<button
								type='button'
								className='min-w-0 truncate font-mono text-xs text-muted-foreground hover:text-foreground hover:underline'
								aria-label={`Open ${file.path} in File Explorer`}
								disabled={isOpeningHistoricalDiff}
								onClick={() => {
									void onOpenHistoricalDiff({ path: file.path, from, to });
								}}
							>
								{file.path}
							</button>
						) : (
							<span className='min-w-0 truncate font-mono text-xs text-muted-foreground'>
								{file.path}
							</span>
						)}
						<span className='shrink-0 font-mono text-xs'>
							{file.additions === null || file.deletions === null ? (
								<span className='text-muted-foreground'>binary</span>
							) : (
								<>
									<span className='text-emerald-600'>+{file.additions}</span>{' '}
									<span className='text-red-600'>−{file.deletions}</span>
								</>
							)}
						</span>
					</li>
				))}
			</ul>
			{hiddenFileCount > 0 && (
				<button
					type='button'
					className='mt-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline'
					aria-expanded={isExpanded}
					onClick={() => {
						onExpandedChange(!isExpanded);
					}}
				>
					{isExpanded ? 'Show less' : `Show ${hiddenFileCount} more`}
				</button>
			)}
		</div>
	);
}

async function invalidateContextQueries(queryClient: QueryClient): Promise<void> {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getRepositoryStatus.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getFileTree.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getChangedFiles.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.readFile.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getFileDiff.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.searchContent.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getLiveContextPullHistory.queryKey() }),
	]);
}
