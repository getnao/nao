import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import type { QueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { SettingsCard } from '@/components/ui/settings-card';
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
	isAdmin: boolean;
}

export function LiveContextUpdateSettings({ status, isAdmin }: LiveContextUpdateSettingsProps) {
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
			description={`Pull the latest "${status.configuredBranch}" branch into this nao instance.`}
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
						<div key={activity.id} className='py-3 first:pt-0 last:pb-0'>
							<div className='flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1'>
								<p className='text-sm font-medium'>{getOutcome(activity)}</p>
								<p className='text-xs text-muted-foreground'>
									{new Date(activity.startedAt).toLocaleString()} ·{' '}
									{activity.actorName ?? 'Unknown admin'}
								</p>
							</div>
							{activity.status === 'failed' && activity.errorMessage && (
								<p className='mt-1 text-sm text-destructive'>{activity.errorMessage}</p>
							)}
							{activity.status === 'completed' && activity.changed && activity.files.length > 0 && (
								<PullFileList files={activity.files} />
							)}
						</div>
					))}
				</div>
			)}
		</SettingsCard>
	);
}

function getOutcome(activity: { status: string; changed: boolean | null; files: unknown[] }): string {
	if (activity.status === 'failed') {
		return 'Failed';
	}
	if (activity.status === 'running') {
		return 'Pull in progress';
	}
	if (activity.status === 'cancelled') {
		return 'Cancelled';
	}
	if (activity.changed === null) {
		return 'Completed';
	}
	if (!activity.changed) {
		return 'Already up to date';
	}
	return activity.files.length === 0
		? 'Repository updated; no context files changed'
		: `Updated ${formatFileCount(activity.files.length)}`;
}

function PullFileList({
	files,
}: {
	files: Array<{ path: string; additions: number | null; deletions: number | null }>;
}) {
	return (
		<ul className='mt-2 space-y-1 text-sm'>
			{files.map((file) => (
				<li key={file.path} className='flex min-w-0 items-center justify-between gap-4'>
					<span className='truncate font-mono text-xs'>{file.path}</span>
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
	);
}

function formatFileCount(count: number): string {
	return `${count} context ${count === 1 ? 'file' : 'files'}`;
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
