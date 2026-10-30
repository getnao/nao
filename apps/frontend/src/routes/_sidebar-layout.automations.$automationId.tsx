import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Check, Github, Loader2, Mail, Play, Trash, X } from 'lucide-react';
import { useState } from 'react';

import type { AutomationFormValue } from '@/components/automations-form';
import { MobileHeader } from '@/components/mobile-header';
import { AutomationForm } from '@/components/automations-form';
import SlackIcon from '@/components/icons/slack.svg';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { isMac } from '@/lib/platform';
import { requireAutomationsEnabled } from '@/lib/route-guards';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/automations/$automationId')({
	beforeLoad: async () => {
		await requireAutomationsEnabled();
	},
	component: AutomationDetailPage,
});

function AutomationDetailPage() {
	const { automationId } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
	const detail = useQuery(
		trpc.automation.get.queryOptions(
			{ id: automationId },
			{
				refetchInterval: (query) =>
					query.state.data?.runs.some((run) => run.status === 'running') ? 1_500 : false,
			},
		),
	);
	const updateAutomation = useMutation(trpc.automation.update.mutationOptions());
	const setAutomationEnabled = useMutation(trpc.automation.setEnabled.mutationOptions());
	const deleteAutomation = useMutation(trpc.automation.delete.mutationOptions());
	const runNow = useMutation(trpc.automation.runNow.mutationOptions());
	const cancelRun = useMutation(trpc.automation.cancelRun.mutationOptions());

	async function handleUpdate(value: AutomationFormValue) {
		await updateAutomation.mutateAsync({
			id: automationId,
			...value,
			enabled: automation?.enabled ?? value.enabled,
		});
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.automation.get.queryKey({ id: automationId }) }),
			queryClient.invalidateQueries({ queryKey: trpc.automation.list.queryKey() }),
		]);
	}

	async function handleDelete() {
		await deleteAutomation.mutateAsync({ id: automationId });
		await queryClient.invalidateQueries({ queryKey: trpc.automation.list.queryKey() });
		navigate({ to: '/feed' });
	}

	async function handleRunNow() {
		await runNow.mutateAsync({ id: automationId });
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.automation.get.queryKey({ id: automationId }) }),
			queryClient.invalidateQueries({ queryKey: trpc.automation.list.queryKey() }),
		]);
	}

	async function handleSetEnabled(enabled: boolean) {
		await setAutomationEnabled.mutateAsync({ id: automationId, enabled });
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.automation.get.queryKey({ id: automationId }) }),
			queryClient.invalidateQueries({ queryKey: trpc.automation.list.queryKey() }),
		]);
	}

	async function handleCancelRun(runId: string) {
		await cancelRun.mutateAsync({ runId });
		await queryClient.invalidateQueries({ queryKey: trpc.automation.get.queryKey({ id: automationId }) });
	}

	const automation = detail.data?.automation;
	const runs = detail.data?.runs ?? [];
	const cancellingRunId = cancelRun.isPending ? (cancelRun.variables?.runId ?? null) : null;
	const automationFormId = `automation-form-${automationId}`;
	const saveShortcutLabel = getSaveShortcutLabel();

	return (
		<div className='flex flex-col flex-1 h-full overflow-auto bg-panel'>
			<MobileHeader />
			<div className='mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8'>
				<div className='mb-6 flex items-center justify-between gap-3 flex-wrap'>
					<Button variant='ghost' size='sm' asChild>
						<Link to='/feed'>
							<ArrowLeft className='size-4' />
							Automations
						</Link>
					</Button>
					<div className='flex items-center gap-2'>
						{automation && hasUnsavedChanges && (
							<Button
								type='submit'
								form={automationFormId}
								disabled={updateAutomation.isPending}
								className='gap-1.5'
							>
								{updateAutomation.isPending ? (
									'Saving...'
								) : (
									<>
										<span>Save changes</span>
										<kbd className='text-[10px] opacity-60 font-sans'>{saveShortcutLabel}</kbd>
									</>
								)}
							</Button>
						)}
						{automation && automation.cron && (
							<div className='flex items-center gap-2 rounded-md border bg-background/60 px-2.5 py-1.75'>
								<Switch
									checked={automation.enabled}
									onCheckedChange={handleSetEnabled}
									disabled={setAutomationEnabled.isPending}
								/>
								<button
									type='button'
									className='text-sm font-medium cursor-pointer disabled:cursor-not-allowed disabled:opacity-50'
									onClick={() => handleSetEnabled(!automation.enabled)}
									disabled={setAutomationEnabled.isPending}
								>
									{automation.enabled ? 'Enabled' : 'Paused'}
								</button>
							</div>
						)}
						<Button variant='secondary' onClick={handleRunNow} disabled={!automation || runNow.isPending}>
							<Play className='size-4' />
							{runNow.isPending ? 'Starting...' : 'Run now'}
						</Button>
						<Button variant='destructive' onClick={handleDelete} disabled={deleteAutomation.isPending}>
							<Trash className='size-4' />
							Delete
						</Button>
					</div>
				</div>

				{!detail.isLoading && !automation && (
					<p className='text-sm text-muted-foreground'>Automation not found.</p>
				)}

				{automation && (
					<AutomationForm
						id={automationFormId}
						automationId={automationId}
						initialValue={{
							title: automation.title,
							prompt: automation.prompt,
							cron: automation.cron,
							scheduleDescription: automation.scheduleDescription ?? undefined,
							modelProvider: automation.modelProvider ?? undefined,
							modelId: automation.modelId ?? undefined,
							enabled: automation.enabled,
							mcpEnabled: automation.mcpEnabled,
							mcpServers: automation.mcpServers ?? undefined,
							integrations: automation.integrations,
							webhookEnabled: automation.webhookEnabled,
						}}
						details={{
							enabled: automation.enabled,
							scheduleDescription: automation.scheduleDescription,
							cron: automation.cron,
							webhookEnabled: automation.webhookEnabled,
							nextRunAt: automation.scheduledJob?.runAt,
							lastRunAt: runs[0]?.startedAt,
						}}
						submitLabel='Save changes'
						isPending={updateAutomation.isPending}
						aside={
							<PreviousRuns runs={runs} onCancelRun={handleCancelRun} cancellingRunId={cancellingRunId} />
						}
						showSubmitButton={false}
						autoSaveControls
						saveShortcut
						onDirtyChange={setHasUnsavedChanges}
						onSubmit={handleUpdate}
					/>
				)}
			</div>
		</div>
	);
}

function getSaveShortcutLabel() {
	return isMac ? '⌘S' : 'Ctrl+S';
}

type AutomationRun = {
	id: string;
	startedAt: string | Date;
	status: string;
	errorMessage?: string | null;
	chatId?: string | null;
	integrationResults: IntegrationResult[];
};

type IntegrationResult = {
	type: string;
	label: string;
	ok: boolean;
	message?: string | null;
	url?: string | null;
	destination?: string | null;
};

type IntegrationResultGroup = {
	type: string;
	destinations: IntegrationResult[];
};

function PreviousRuns({
	runs,
	onCancelRun,
	cancellingRunId,
}: {
	runs: AutomationRun[];
	onCancelRun: (runId: string) => void;
	cancellingRunId: string | null;
}) {
	return (
		<section className='grid gap-2 rounded-xl border bg-background/60 p-4'>
			<div className='flex items-center justify-between gap-3'>
				<h2 className='text-sm font-medium'>Previous runs</h2>
				{runs.length > 0 && <span className='text-xs text-muted-foreground'>{runs.length}</span>}
			</div>
			<div className='grid max-h-[18rem] overflow-auto pr-1'>
				{runs.length === 0 && <p className='text-sm text-muted-foreground'>No runs yet.</p>}
				{runs.map((run) => (
					<PreviousRunRow
						key={run.id}
						run={run}
						onCancelRun={onCancelRun}
						isCancelling={cancellingRunId === run.id}
					/>
				))}
			</div>
		</section>
	);
}

function PreviousRunRow({
	run,
	onCancelRun,
	isCancelling,
}: {
	run: AutomationRun;
	onCancelRun: (runId: string) => void;
	isCancelling: boolean;
}) {
	const navigate = useNavigate();
	const canOpenChat = Boolean(run.chatId);
	const isRunning = run.status === 'running';

	function openChat() {
		if (run.chatId) {
			navigate({ to: '/$chatId', params: { chatId: run.chatId } });
		}
	}

	const content = (
		<>
			<div className='flex items-center justify-between gap-2 text-xs'>
				<div className='min-w-0 truncate text-muted-foreground'>{new Date(run.startedAt).toLocaleString()}</div>
				<div className='flex items-center gap-1.5'>
					{isRunning && (
						<Button
							type='button'
							variant='ghost'
							size='sm'
							className='h-6 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-destructive'
							disabled={isCancelling}
							onClick={(event) => {
								event.stopPropagation();
								onCancelRun(run.id);
							}}
							onKeyDown={(event) => {
								event.stopPropagation();
							}}
						>
							{isCancelling ? <Loader2 className='size-3 animate-spin' /> : <X className='size-3' />}
							<span>{isCancelling ? 'Cancelling…' : 'Cancel'}</span>
						</Button>
					)}
					<Badge variant={getRunStatusBadgeVariant(run.status)} className='px-1.5 py-0 text-[10px]'>
						{run.status}
					</Badge>
				</div>
			</div>
			{run.errorMessage && <p className='mt-2 text-xs text-destructive'>{run.errorMessage}</p>}
			{run.integrationResults.length > 0 && (
				<IntegrationResultIcons runId={run.id} results={run.integrationResults} />
			)}
		</>
	);

	const className = 'px-2 py-2 first:pt-2 last:pb-2 rounded-md transition-colors';

	if (!canOpenChat) {
		return <div className={className}>{content}</div>;
	}

	return (
		<div
			role='link'
			tabIndex={0}
			onClick={openChat}
			onKeyDown={(event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					openChat();
				}
			}}
			className={`${className} cursor-pointer hover:bg-muted/50`}
		>
			{content}
		</div>
	);
}

function getRunStatusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
	if (status === 'failed') {
		return 'destructive';
	}
	if (status === 'cancelled') {
		return 'outline';
	}
	return 'secondary';
}

function IntegrationResultIcons({ runId, results }: { runId: string; results: IntegrationResult[] }) {
	const groups = groupIntegrationResults(results);

	return (
		<div className='mt-2 flex flex-wrap gap-1.5'>
			{groups.map((group) =>
				group.destinations.length === 1 ? (
					<IntegrationResultIcon key={`${runId}-${group.type}`} result={group.destinations[0]} />
				) : (
					<MultiDestinationResultIcon key={`${runId}-${group.type}`} group={group} />
				),
			)}
		</div>
	);
}

function MultiDestinationResultIcon({ group }: { group: IntegrationResultGroup }) {
	const config = getIntegrationIconConfig(group.type);
	const deliveredCount = group.destinations.filter((result) => result.ok).length;
	const totalCount = group.destinations.length;
	const summary = `${config.label}: ${deliveredCount} of ${totalCount} delivered`;

	return (
		<Tooltip delayDuration={150}>
			<TooltipTrigger asChild>
				<span
					className={cn(
						'flex h-6 items-center gap-1 rounded-full border bg-background pl-1.5 pr-2 text-[10px] font-medium shadow-xs transition-colors',
						getDeliveryClassName(deliveredCount, totalCount, config.successClassName),
					)}
					aria-label={summary}
				>
					{config.icon}
					<span>
						{deliveredCount}/{totalCount}
					</span>
				</span>
			</TooltipTrigger>
			<TooltipContent className='max-w-[300px]'>
				<DestinationResultsBreakdown summary={summary} destinations={group.destinations} />
			</TooltipContent>
		</Tooltip>
	);
}

function DestinationResultsBreakdown({
	summary,
	destinations,
}: {
	summary: string;
	destinations: IntegrationResult[];
}) {
	return (
		<div className='grid gap-1 py-0.5'>
			<p className='font-medium'>{summary}</p>
			<ul className='grid gap-0.5'>
				{destinations.map((result) => (
					<li key={result.destination ?? result.label} className='flex items-start gap-1.5'>
						{result.ok ? (
							<Check className='mt-0.5 size-3 shrink-0 text-green-600' />
						) : (
							<X className='mt-0.5 size-3 shrink-0 text-destructive' />
						)}
						<span className='min-w-0'>
							<span className='font-mono'>{result.destination ?? result.label}</span>
							{!result.ok && result.message && (
								<span className='text-muted-foreground'>: {result.message}</span>
							)}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

function getDeliveryClassName(deliveredCount: number, totalCount: number, successClassName: string): string {
	if (deliveredCount === totalCount) {
		return successClassName;
	}
	if (deliveredCount === 0) {
		return 'border-muted text-muted-foreground opacity-60 grayscale';
	}
	return 'border-amber-300 bg-amber-50 text-amber-700';
}

function IntegrationResultIcon({ result }: { result: IntegrationResult }) {
	const config = getIntegrationIconConfig(result.type);
	const content = (
		<span
			className={cn(
				'flex size-6 items-center justify-center rounded-full border bg-background shadow-xs transition-colors',
				result.ok ? config.successClassName : 'border-muted text-muted-foreground opacity-60 grayscale',
			)}
			aria-label={getIntegrationResultLabel(result, config.label)}
		>
			{config.icon}
		</span>
	);

	const trigger =
		result.ok && result.url ? (
			<a
				href={result.url}
				target='_blank'
				rel='noreferrer'
				onClick={(event) => event.stopPropagation()}
				onKeyDown={(event) => event.stopPropagation()}
			>
				{content}
			</a>
		) : (
			content
		);

	return (
		<Tooltip delayDuration={150}>
			<TooltipTrigger asChild>{trigger}</TooltipTrigger>
			<TooltipContent>
				{result.ok ? `${config.label} sent successfully` : result.message || `${config.label} has failed`}
			</TooltipContent>
		</Tooltip>
	);
}

/** Several tool calls can target one destination (e.g. a Slack headline and its thread replies); they count once. */
function groupIntegrationResults(results: IntegrationResult[]): IntegrationResultGroup[] {
	const destinationsByType = new Map<string, Map<string, IntegrationResult>>();

	for (const result of results) {
		const destinations = destinationsByType.get(result.type) ?? new Map<string, IntegrationResult>();
		const destinationKey = result.destination ?? result.label;
		const current = destinations.get(destinationKey);
		destinations.set(destinationKey, current ? mergeIntegrationResults(current, result) : result);
		destinationsByType.set(result.type, destinations);
	}

	return [...destinationsByType].map(([type, destinations]) => ({ type, destinations: [...destinations.values()] }));
}

function mergeIntegrationResults(current: IntegrationResult, next: IntegrationResult): IntegrationResult {
	const failedResult = !current.ok ? current : !next.ok ? next : null;

	return {
		type: current.type,
		label: current.label,
		destination: current.destination,
		ok: current.ok && next.ok,
		message: failedResult?.message ?? current.message ?? next.message,
		url: current.url ?? next.url,
	};
}

function getIntegrationIconConfig(type: string) {
	if (type === 'slack') {
		return {
			label: 'Slack',
			icon: <SlackIcon className='size-3.5' />,
			successClassName: 'border-transparent bg-white text-foreground',
		};
	}
	if (type === 'github') {
		return {
			label: 'GitHub',
			icon: <Github className='size-3.5' />,
			successClassName: 'border-transparent bg-foreground text-background',
		};
	}
	if (type === 'email') {
		return {
			label: 'Email',
			icon: <Mail className='size-3.5' />,
			successClassName: 'border-blue-200 bg-blue-50 text-blue-600',
		};
	}
	return {
		label: type,
		icon: <Mail className='size-3.5' />,
		successClassName: 'border-blue-200 bg-blue-50 text-blue-600',
	};
}

function getIntegrationResultLabel(result: IntegrationResult, label: string) {
	return result.ok ? `${label} sent successfully` : `${label} has failed`;
}
