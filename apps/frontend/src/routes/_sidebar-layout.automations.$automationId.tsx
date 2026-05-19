import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Github, Mail, Play, Trash } from 'lucide-react';
import { useState } from 'react';

import type { AutomationFormValue } from '@/components/automations-form';
import { MobileHeader } from '@/components/mobile-header';
import { AutomationForm } from '@/components/automations-form';
import SlackIcon from '@/components/icons/slack.svg';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/automations/$automationId')({
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
		navigate({ to: '/automations' });
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

	const automation = detail.data?.automation;
	const runs = detail.data?.runs ?? [];
	const automationFormId = `automation-form-${automationId}`;
	const saveShortcutLabel = getSaveShortcutLabel();

	return (
		<div className='flex flex-col flex-1 h-full overflow-auto bg-panel'>
			<MobileHeader />
			<div className='mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8'>
				<div className='mb-6 flex items-center justify-between gap-3 flex-wrap'>
					<Button variant='ghost' size='sm' asChild>
						<Link to='/automations'>
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
						{automation && (
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
						}}
						details={{
							enabled: automation.enabled,
							nextRunAt: automation.scheduledJob?.runAt,
							lastRunAt: runs[0]?.startedAt,
						}}
						submitLabel='Save changes'
						isPending={updateAutomation.isPending}
						aside={<PreviousRuns runs={runs} />}
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
	if (typeof navigator !== 'undefined' && navigator.platform.includes('Mac')) {
		return '⌘S';
	}
	return 'Ctrl+S';
}

type AutomationRun = {
	id: string;
	startedAt: string | Date;
	status: string;
	errorMessage?: string | null;
	chatId?: string | null;
	integrationResults: {
		type: string;
		label: string;
		ok: boolean;
		message?: string | null;
		url?: string | null;
	}[];
};

function PreviousRuns({ runs }: { runs: AutomationRun[] }) {
	return (
		<section className='grid gap-2 rounded-xl border bg-background/60 p-4'>
			<div className='flex items-center justify-between gap-3'>
				<h2 className='text-sm font-medium'>Previous runs</h2>
				{runs.length > 0 && <span className='text-xs text-muted-foreground'>{runs.length}</span>}
			</div>
			<div className='grid max-h-[18rem] overflow-auto pr-1'>
				{runs.length === 0 && <p className='text-sm text-muted-foreground'>No runs yet.</p>}
				{runs.map((run) => (
					<PreviousRunRow key={run.id} run={run} />
				))}
			</div>
		</section>
	);
}

function PreviousRunRow({ run }: { run: AutomationRun }) {
	const navigate = useNavigate();
	const canOpenChat = Boolean(run.chatId);

	function openChat() {
		if (run.chatId) {
			navigate({ to: '/$chatId', params: { chatId: run.chatId } });
		}
	}

	const content = (
		<>
			<div className='flex items-center justify-between gap-2 text-xs'>
				<div className='min-w-0 truncate text-muted-foreground'>{new Date(run.startedAt).toLocaleString()}</div>
				<Badge
					variant={run.status === 'failed' ? 'destructive' : 'secondary'}
					className='px-1.5 py-0 text-[10px]'
				>
					{run.status}
				</Badge>
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

function IntegrationResultIcons({ runId, results }: { runId: string; results: AutomationRun['integrationResults'] }) {
	const distinctResults = getDistinctIntegrationResults(results);

	return (
		<TooltipProvider delayDuration={150}>
			<div className='mt-2 flex flex-wrap gap-1.5'>
				{distinctResults.map((result) => (
					<IntegrationResultIcon key={`${runId}-${result.type}`} result={result} />
				))}
			</div>
		</TooltipProvider>
	);
}

function IntegrationResultIcon({ result }: { result: AutomationRun['integrationResults'][number] }) {
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
		<Tooltip>
			<TooltipTrigger asChild>{trigger}</TooltipTrigger>
			<TooltipContent>
				{result.ok ? `${config.label} sent successfully` : result.message || `${config.label} has failed`}
			</TooltipContent>
		</Tooltip>
	);
}

function getDistinctIntegrationResults(results: AutomationRun['integrationResults']) {
	const resultsByType = new Map<string, AutomationRun['integrationResults'][number]>();

	for (const result of results) {
		const current = resultsByType.get(result.type);
		if (!current) {
			resultsByType.set(result.type, result);
			continue;
		}

		resultsByType.set(result.type, mergeIntegrationResults(current, result));
	}

	return [...resultsByType.values()];
}

function mergeIntegrationResults(
	current: AutomationRun['integrationResults'][number],
	next: AutomationRun['integrationResults'][number],
): AutomationRun['integrationResults'][number] {
	const failedResult = !current.ok ? current : !next.ok ? next : null;

	return {
		type: current.type,
		label: current.label,
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

function getIntegrationResultLabel(result: AutomationRun['integrationResults'][number], label: string) {
	return result.ok ? `${label} sent successfully` : `${label} has failed`;
}
