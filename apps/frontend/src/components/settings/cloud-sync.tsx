import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, CircleDot, Terminal, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { invalidateExplorerQueries } from '@/lib/context-explorer-queries';
import { getTimeAgo } from '@/lib/time-ago';
import { trpc } from '@/main';

export function CloudSyncPanel({ isAdmin }: { isAdmin: boolean }) {
	const queryClient = useQueryClient();
	const refreshedRunId = useRef<string | null>(null);
	const terminalRef = useRef<HTMLPreElement | null>(null);
	const shouldFollowLogs = useRef(true);
	const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);
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
			onError: () => setCancellingRunId(null),
		}),
	);
	const run = syncState.data?.run ?? null;
	const lastSyncedAt = syncState.data?.lastSyncedAt ?? null;
	const lastSyncedBy = syncState.data?.lastSyncedBy ?? null;
	const isSyncing = startSync.isPending || run?.status === 'queued' || run?.status === 'running';
	const isComplete = run?.status === 'succeeded';
	const isFailed = run?.status === 'failed';
	const isCancelled = run?.status === 'cancelled';
	const isCancelling = cancellingRunId === run?.id && (run?.status === 'queued' || run?.status === 'running');
	const isCompletedWithErrors = run?.status === 'completed_with_errors';
	const error = startSync.error?.message ?? cancelSync.error?.message ?? run?.error ?? syncState.error?.message;

	useEffect(() => {
		if (
			!run ||
			!['succeeded', 'failed', 'cancelled', 'completed_with_errors'].includes(run.status) ||
			refreshedRunId.current === run.id
		) {
			return;
		}
		refreshedRunId.current = run.id;
		void invalidateExplorerQueries(queryClient);
	}, [queryClient, run]);

	const previousSyncingBy = useRef<string | null>(null);

	useEffect(() => {
		if (previousSyncingBy.current && !syncingBy) {
			void invalidateExplorerQueries(queryClient);
		}
		previousSyncingBy.current = syncingBy;
	}, [queryClient, syncingBy]);

	useEffect(() => {
		shouldFollowLogs.current = true;
	}, [run?.id]);

	useEffect(() => {
		if (!run || !['queued', 'running'].includes(run.status)) {
			setCancellingRunId(null);
		}
	}, [run]);

	useEffect(() => {
		const terminal = terminalRef.current;
		if (terminal && shouldFollowLogs.current) {
			terminal.scrollTop = terminal.scrollHeight;
		}
	}, [run?.logs]);

	return (
		<div className='flex min-w-0 flex-col gap-3 px-2 py-3'>
			<p className='break-words pr-2 pl-[13px] text-[11px] text-muted-foreground'>
				{isAdmin
					? "Refresh this project's configured databases, repositories, and documentation."
					: 'Only project admins can start or stop a sync. You can view its status here.'}
			</p>
			{run && syncState.data?.available && isAdmin && (
				<div className='mx-2 min-w-0 overflow-hidden rounded-md border border-white/10 bg-zinc-950 shadow-sm'>
					<div className='flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-white/10 px-2.5 py-1.5'>
						<div className='flex min-w-0 items-center gap-1.5 text-[10px] text-zinc-400'>
							<Terminal className='size-3' />
							nao sync
						</div>
						<div className='flex shrink-0 items-center gap-1.5 text-[10px]'>
							{isCancelling ? (
								<>
									<span className='size-1.5 animate-pulse rounded-full bg-violet' />
									<span className='text-zinc-400'>Cancelling</span>
								</>
							) : isSyncing ? (
								<>
									<span className='size-1.5 animate-pulse rounded-full bg-violet' />
									<span className='text-zinc-400'>Running</span>
									<button
										type='button'
										className='ml-1 text-zinc-500 hover:text-zinc-200'
										disabled={cancelSync.isPending}
										onClick={() => {
											setCancellingRunId(run.id);
											cancelSync.mutate();
										}}
									>
										Stop
									</button>
								</>
							) : isCompletedWithErrors ? (
								<>
									<CircleDot className='size-3 text-amber-400' />
									<span className='text-amber-400'>Completed with errors</span>
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
						className='h-60 min-h-20 w-full max-w-full max-h-[70vh] resize-y overflow-auto whitespace-pre-wrap p-2.5 font-mono text-[10px] leading-relaxed text-zinc-300'
						aria-live='polite'
						onScroll={(event) => {
							const terminal = event.currentTarget;
							shouldFollowLogs.current =
								terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 8;
						}}
					>
						{isCancelling
							? `${run.logs ? `${run.logs}\n` : ''}Cancelling sync... This may take a minute.`
							: run.logs || (isSyncing ? 'Waiting for sync to start...' : 'No logs available.')}
					</pre>
				</div>
			)}
			{error && (
				<p
					className={`break-words pr-2 pl-[13px] px-2 text-[11px] leading-4 ${
						isCompletedWithErrors ? 'text-amber-400' : 'text-destructive'
					}`}
				>
					{error}
				</p>
			)}
			<div className='flex flex-wrap items-center justify-end gap-2 px-2'>
				<span className='min-w-0 flex-1 break-words text-[10px] text-muted-foreground'>
					{isSyncing
						? null
						: syncingBy
							? `Project is currently being synced by ${syncingBy}`
							: lastSyncedAt
								? `Last synced ${getTimeAgo(lastSyncedAt.getTime()).humanReadable.toLowerCase()}${lastSyncedBy ? ` by ${lastSyncedBy}` : ''}`
								: null}
				</span>
				{isAdmin && (
					<Button
						type='button'
						size='sm'
						variant='secondary'
						className='h-6 w-fit shrink-0 gap-1 px-1.5 text-[11px]'
						disabled={isSyncing || syncState.isLoading || syncState.isError || !!syncingBy}
						isLoading={isSyncing}
						onClick={() => {
							startSync.reset();
							cancelSync.reset();
							startSync.mutate();
						}}
					>
						{isComplete ? 'Sync again' : isFailed || isCompletedWithErrors ? 'Retry sync' : 'Sync project'}
					</Button>
				)}
			</div>
		</div>
	);
}
