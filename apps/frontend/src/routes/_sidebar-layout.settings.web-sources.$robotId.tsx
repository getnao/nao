import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Archive, ChevronLeft, Download, Play } from 'lucide-react';
import { useState } from 'react';

import type { WebRobotRun } from '@/components/settings/web-source-recipe';
import { WebSourceForm } from '@/components/settings/web-source-form';
import { formatDateTime, isActiveWebRobotRun, recipeSummary } from '@/components/settings/web-source-recipe';
import { WebSourceRuns } from '@/components/settings/web-source-runs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Empty } from '@/components/ui/empty';
import { ErrorMessage } from '@/components/ui/error-message';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { requireWebRobotsEnabled } from '@/lib/require-admin';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/web-sources/$robotId')({
	beforeLoad: requireWebRobotsEnabled,
	staticData: {
		title: 'Web source',
	},
	component: WebSourceDetailPage,
});

function WebSourceDetailPage() {
	const { robotId } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [showArchive, setShowArchive] = useState(false);
	const robot = useQuery(trpc.webRobot.get.queryOptions({ id: robotId }));
	const exportRobot = useQuery({ ...trpc.webRobot.exportRobot.queryOptions({ id: robotId }), enabled: false });
	const runs = useQuery({
		...trpc.webRobot.listRuns.queryOptions({ id: robotId, limit: 20 }),
		enabled: Boolean(robot.data),
		refetchInterval: (query) => (query.state.data?.some((run) => isActiveWebRobotRun(run.status)) ? 3000 : false),
	});
	const update = useMutation(trpc.webRobot.update.mutationOptions());
	const archive = useMutation(trpc.webRobot.archive.mutationOptions());
	const runNow = useMutation(trpc.webRobot.runNow.mutationOptions());
	const cancelRun = useMutation(trpc.webRobot.cancelRun.mutationOptions());
	const setEnabled = useMutation(trpc.webRobot.setEnabled.mutationOptions());

	const invalidate = async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.webRobot.get.queryKey({ id: robotId }) }),
			queryClient.invalidateQueries({ queryKey: trpc.webRobot.list.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.webRobot.listRuns.queryKey({ id: robotId, limit: 20 }) }),
		]);
	};

	const data = robot.data;
	const activeRun = runs.data?.find((run) => isActiveWebRobotRun(run.status));
	const summary = data ? recipeSummary(data.definition) : null;

	const handleExport = async () => {
		const result = await exportRobot.refetch();
		if (!result.data) {
			return;
		}
		const url = URL.createObjectURL(new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = `${result.data.slug || 'web-source'}.json`;
		link.click();
		URL.revokeObjectURL(url);
	};

	if (robot.isLoading) {
		return (
			<SettingsPageWrapper>
				<div className='flex items-center gap-2 text-sm text-muted-foreground'>
					<Spinner /> Loading web source…
				</div>
			</SettingsPageWrapper>
		);
	}

	if (robot.error || !data) {
		return (
			<SettingsPageWrapper>
				<ErrorMessage message={robot.error?.message ?? 'Web source not found.'} />
			</SettingsPageWrapper>
		);
	}

	return (
		<SettingsPageWrapper wide>
			<div className='flex flex-col gap-8'>
				<div className='flex flex-wrap items-start justify-between gap-3'>
					<div>
						<Button asChild variant='ghost-muted' size='sm' className='-ml-2 mb-2'>
							<Link to='/settings/web-sources'>
								<ChevronLeft className='size-3.5' />
								Web sources
							</Link>
						</Button>
						<div className='flex flex-wrap items-center gap-2'>
							<h1 className='text-lg font-semibold text-foreground'>{data.name}</h1>
							<Badge variant='secondary'>{data.slug}</Badge>
							{data.cron ? (
								<Badge variant={data.enabled ? 'success' : 'outline'}>
									{data.enabled ? 'enabled' : 'paused'}
								</Badge>
							) : (
								<Badge variant='outline'>manual</Badge>
							)}
						</div>
						{data.description && (
							<p className='mt-1 max-w-3xl text-sm text-muted-foreground'>{data.description}</p>
						)}
					</div>
					<div className='flex gap-2'>
						<Button
							type='button'
							variant='secondary'
							disabled={Boolean(activeRun) || runNow.isPending}
							isLoading={runNow.isPending}
							onClick={async () => {
								await runNow.mutateAsync({ id: data.id });
								await invalidate();
							}}
						>
							<Play className='size-3.5' />
							Run now
						</Button>
						<Button
							type='button'
							variant='ghost-muted'
							isLoading={exportRobot.isFetching}
							onClick={() => void handleExport()}
						>
							<Download className='size-3.5' />
							Export
						</Button>
						<Button type='button' variant='destructive-soft' onClick={() => setShowArchive(true)}>
							<Archive className='size-3.5' />
							Archive
						</Button>
					</div>
				</div>

				{runNow.error && <ErrorMessage message={runNow.error.message} />}
				{exportRobot.error && <ErrorMessage message={exportRobot.error.message} />}
				{cancelRun.error && <ErrorMessage message={cancelRun.error.message} />}
				{setEnabled.error && <ErrorMessage message={setEnabled.error.message} />}
				{runs.error && <ErrorMessage message={runs.error.message} />}

				<SettingsCard
					title='Publication'
					description='Latest generated dataset and scheduling state.'
					action={
						data.cron ? (
							<div className='flex items-center gap-2'>
								<Switch
									checked={data.enabled}
									disabled={setEnabled.isPending}
									onCheckedChange={async (enabled) => {
										await setEnabled.mutateAsync({ id: data.id, enabled });
										await invalidate();
									}}
								/>
								<span className='text-sm'>{data.enabled ? 'Enabled' : 'Paused'}</span>
							</div>
						) : undefined
					}
				>
					<div className='grid gap-3 md:grid-cols-4'>
						<SummaryStat label='Products' value={String(data.lastPublishedProductCount ?? '—')} />
						<SummaryStat label='Last publish' value={formatDateTime(data.lastSuccessfulRunAt)} />
						<SummaryStat
							label='Next run'
							value={data.enabled ? formatDateTime(data.scheduledJob?.runAt) : '—'}
						/>
						<SummaryStat label='Stages' value={String(summary?.stageCount ?? '—')} />
					</div>
					{data.lastSuccessfulRunId && (
						<div className='rounded-md border bg-muted/20 p-3 font-mono text-xs text-muted-foreground'>
							/datasets/{data.slug}/latest
						</div>
					)}
					{activeRun && (
						<div className='flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3'>
							<div className='text-sm'>
								<span className='font-medium'>{activeRun.status}</span>{' '}
								<span className='text-muted-foreground'>
									queued {formatDateTime(activeRun.queuedAt)}
								</span>
							</div>
							<Button
								type='button'
								variant='secondary'
								size='sm'
								isLoading={cancelRun.isPending && cancelRun.variables?.runId === activeRun.id}
								onClick={() => handleCancelRun(activeRun)}
							>
								Cancel run
							</Button>
						</div>
					)}
				</SettingsCard>

				<WebSourceForm
					key={`${data.id}-${data.definitionHash}-${new Date(data.updatedAt).getTime()}`}
					initial={{
						name: data.name,
						slug: data.slug,
						description: data.description,
						cron: data.cron,
						enabled: data.enabled,
						recipe: data.definition,
					}}
					isCreate={false}
					submitLabel='Save changes'
					isPending={update.isPending}
					submitError={update.error?.message}
					definitionHash={data.definitionHash}
					onSubmit={async (value) => {
						await update.mutateAsync({ id: data.id, ...value });
						await invalidate();
					}}
				/>

				{runs.data ? (
					<WebSourceRuns
						robotId={data.id}
						definitionHash={data.definitionHash}
						runs={runs.data}
						onCancelRun={handleCancelRun}
						onRepairApplied={invalidate}
						cancellingRunId={cancelRun.isPending ? cancelRun.variables?.runId : null}
					/>
				) : (
					<SettingsCard title='Run history'>
						<Empty>No run history loaded.</Empty>
					</SettingsCard>
				)}
			</div>

			<ConfirmationDialog
				open={showArchive}
				onOpenChange={setShowArchive}
				title={`Archive ${data.name}?`}
				description='This disables its schedule and hides the source. Generated dataset files are preserved.'
				confirmLabel='Archive'
				isPending={archive.isPending}
				error={archive.error?.message}
				onConfirm={async () => {
					try {
						await archive.mutateAsync({ id: data.id });
						await navigate({ to: '/settings/web-sources' });
					} catch {
						return;
					}
				}}
			/>
		</SettingsPageWrapper>
	);

	async function handleCancelRun(run: WebRobotRun) {
		await cancelRun.mutateAsync({ runId: run.id });
		await invalidate();
	}
}

function SummaryStat({ label, value }: { label: string; value: string }) {
	return (
		<div className='rounded-md border bg-muted/20 p-3'>
			<div className='text-xs text-muted-foreground'>{label}</div>
			<div className='mt-1 truncate text-sm font-medium'>{value}</div>
		</div>
	);
}
