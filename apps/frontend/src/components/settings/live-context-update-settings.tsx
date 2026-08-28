import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';

import type { QueryClient } from '@tanstack/react-query';
import type { LiveContextRepository } from '@/lib/live-context-links';

import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { SettingsCard } from '@/components/ui/settings-card';
import { formatChangedFileCount, getHiddenPullFileCount, getVisiblePullFiles } from '@/lib/live-context-history';
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
	files: Array<{ path: string; additions: number | null; deletions: number | null }>;
	errorMessage: string | null;
}

export function LiveContextUpdateSettings({ status, repository, isAdmin }: LiveContextUpdateSettingsProps) {
	const queryClient = useQueryClient();
	const history = useQuery(trpc.contextExplorer.getLiveContextPullHistory.queryOptions());
	const pullContext = useMutation(
		trpc.contextExplorer.pullLiveContext.mutationOptions({
			onSettled: async () => {
				await invalidateContextQueries(queryClient);
			},
		}),
	);
	const latestRecordedError = history.data?.[0]?.status === 'failed' ? history.data[0].errorMessage : null;

	return (
		<SettingsCard
			title='Update context files'
			icon={<RefreshCw className='size-4' />}
			description={`Pull the latest changes from Git`}
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
						<HistoryEntry key={activity.id} activity={activity} repository={repository} />
					))}
				</div>
			)}
		</SettingsCard>
	);
}

function HistoryEntry({
	activity,
	repository,
}: {
	activity: PullHistoryEntry;
	repository: LiveContextRepository | null;
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
			{hasCompletedDiff && activity.files.length > 0 ? (
				<p className='mt-2 text-xs text-muted-foreground'>{formatChangedFileCount(activity.files.length)}</p>
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
}: {
	files: Array<{ path: string; additions: number | null; deletions: number | null }>;
	from: string | null;
	to: string | null;
	isExpanded: boolean;
	onExpandedChange: (expanded: boolean) => void;
}) {
	const visibleFiles = getVisiblePullFiles(files, isExpanded);
	const hiddenFileCount = getHiddenPullFileCount(files.length);

	return (
		<div className='mt-2'>
			<ul className='space-y-1 text-sm'>
				{visibleFiles.map((file) => (
					<li key={file.path} className='flex min-w-0 items-center justify-between gap-4'>
						{from && to ? (
							<Link
								to='/settings/context-explorer'
								search={{ path: file.path, from, to }}
								className='min-w-0 truncate font-mono text-xs text-muted-foreground hover:text-foreground hover:underline'
								aria-label={`Open ${file.path} in File Explorer`}
							>
								{file.path}
							</Link>
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
