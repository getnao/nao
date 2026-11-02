import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, RefreshCw, Terminal, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { invalidateExplorerQueries } from '@/components/settings/context-git-panel';
import { Button } from '@/components/ui/button';
import { Expandable } from '@/components/ui/expandable';
import { useSidebarSectionOpen } from '@/hooks/use-sidebar-section-open';
import { getTimeAgo } from '@/lib/time-ago';
import { trpc } from '@/main';

export function CloudSyncPanel() {
	const { isOpen, setIsOpen } = useSidebarSectionOpen('context-explorer-cloud-sync', false);
	const queryClient = useQueryClient();
	const refreshedRunId = useRef<string | null>(null);
	const terminalRef = useRef<HTMLPreElement | null>(null);
	const shouldFollowLogs = useRef(true);
	const syncState = useQuery({
		...trpc.projectSync.getStatus.queryOptions(),
		refetchInterval: (query) => {
			const data = query.state.data;
			const isOwnRunActive = data?.run?.status === 'queued' || data?.run?.status === 'running';
			return isOwnRunActive || data?.syncingBy ? 1000 : false;
		},
	});
	const syncingBy = syncState.data?.syncingBy ?? null;
	const startSync = useMutation(
		trpc.projectSync.start.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: trpc.projectSync.getStatus.queryKey() });
			},
		}),
	);
	const cancelSync = useMutation(
		trpc.projectSync.cancel.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: trpc.projectSync.getStatus.queryKey() });
			},
		}),
	);
	const run = syncState.data?.run ?? null;
	const lastSyncedAt = syncState.data?.lastSyncedAt ?? null;
	const lastSyncedBy = syncState.data?.lastSyncedBy ?? null;
	const isSyncing = startSync.isPending || run?.status === 'queued' || run?.status === 'running';
	const isComplete = run?.status === 'succeeded';
	const isFailed = run?.status === 'failed';
	const isCancelled = run?.status === 'cancelled';
	const error = startSync.error?.message ?? run?.error ?? syncState.error?.message;

	useEffect(() => {
		if (!run || run.status !== 'succeeded' || refreshedRunId.current === run.id) {
			return;
		}
		refreshedRunId.current = run.id;
		void invalidateExplorerQueries(queryClient);
	}, [queryClient, run]);

	useEffect(() => {
		shouldFollowLogs.current = true;
	}, [run?.id]);

	useEffect(() => {
		const terminal = terminalRef.current;
		if (terminal && shouldFollowLogs.current) {
			terminal.scrollTop = terminal.scrollHeight;
		}
	}, [run?.logs]);

	if (syncState.data && !syncState.data.available) {
		return null;
	}

	return (
		<div className='shrink-0 border-t'>
			<Expandable
				title={
					<span className='flex items-center gap-2'>
						<RefreshCw className='size-3.5' />
						Sync
					</span>
				}
				expanded={isOpen}
				onExpandedChange={setIsOpen}
				variant='plain'
				isLoading={syncState.isLoading}
			>
				<div className='flex flex-col gap-3 px-2 py-3'>
					<p className='pr-2 pl-[13px] text-[11px] text-muted-foreground'>
						Refresh this project's configured databases, repositories, and documentation.
					</p>
					{run && (
						<div className='mx-2 overflow-hidden rounded-md border border-white/10 bg-zinc-950 shadow-sm'>
							<div className='flex items-center justify-between border-b border-white/10 px-2.5 py-1.5'>
								<div className='max-h-40 flex items-center gap-1.5 text-[10px] text-zinc-400'>
									<Terminal className='size-3' />
									nao sync
								</div>
								<div className='flex items-center gap-1.5 text-[10px]'>
									{isSyncing ? (
										<>
											<span className='size-1.5 animate-pulse rounded-full bg-violet' />
											<span className='text-zinc-400'>Running</span>
											<button
												type='button'
												className='ml-1 text-zinc-500 hover:text-zinc-200'
												disabled={cancelSync.isPending}
												onClick={() => cancelSync.mutate()}
											>
												Stop
											</button>
										</>
									) : isFailed ? (
										<>
											<CircleAlert className='size-3 text-red-400' />
											<span className='text-red-400'>Failed</span>
										</>
									) : isCancelled ? (
										<>
											<X className='size-3' />
											<span>Cancelled</span>
										</>
									) : (
										<>
											<CheckCircle2 className='size-3 text-emerald-400' />
											<span className='text-emerald-400'>Complete</span>
										</>
									)}
								</div>
							</div>
							<pre
								ref={terminalRef}
								className='max-h-30 overflow-auto whitespace-pre-wrap p-2.5 font-mono text-[10px] leading-relaxed text-zinc-300'
								aria-live='polite'
								onScroll={(event) => {
									const terminal = event.currentTarget;
									shouldFollowLogs.current =
										terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 8;
								}}
							>
								{run.logs || (isSyncing ? 'Waiting for sync to start...' : 'No logs available.')}
							</pre>
						</div>
					)}
					{error && <p className='pr-2 pl-[13px] px-2 text-[11px] leading-4 text-destructive'>{error}</p>}
					<div className='flex items-center justify-end gap-2 px-2'>
						<span className='text-[10px] text-muted-foreground'>
							{isSyncing
								? null
								: syncingBy
									? `Project is currently being synced by ${syncingBy}`
									: lastSyncedAt
										? `Last synced ${getTimeAgo(lastSyncedAt.getTime()).humanReadable.toLowerCase()}${lastSyncedBy ? ` by ${lastSyncedBy}` : ''}`
										: null}
						</span>
						<Button
							type='button'
							size='sm'
							variant='secondary'
							className='h-6 w-fit gap-1 px-1.5 text-[11px]'
							disabled={isSyncing || syncState.isLoading || syncState.isError || !!syncingBy}
							isLoading={isSyncing}
							onClick={() => {
								startSync.reset();
								startSync.mutate();
							}}
						>
							{isComplete ? 'Sync again' : isFailed ? 'Retry sync' : 'Sync project'}
						</Button>
					</div>
				</div>
			</Expandable>
		</div>
	);
}
