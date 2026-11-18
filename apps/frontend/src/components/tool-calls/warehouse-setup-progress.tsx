import { CheckCircle2, Circle, CircleAlert, Loader2, Terminal } from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';

import type { TrpcRouter } from '@nao/backend/trpc';

import { getLatestPercentage } from '@/components/onboarding-progress';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type WarehouseSetupJob = NonNullable<
	inferRouterOutputs<TrpcRouter>['onboarding']['getLatestWarehouseProvisioningJob']
>;

type SetupStatus = WarehouseSetupJob['status'];
type StepState = 'done' | 'active' | 'failed' | 'pending';

interface SetupStep {
	status: SetupStatus;
	label: string;
	command?: string;
}

const SETUP_STEPS: SetupStep[] = [
	{ status: 'queued', label: 'Prepare the connection' },
	{ status: 'initializing', label: 'Initialize the project', command: 'nao init' },
	{ status: 'debugging', label: 'Check the connection', command: 'nao debug' },
	{ status: 'syncing', label: 'Sync warehouse metadata', command: 'nao sync' },
	{ status: 'registering', label: 'Register the project' },
	{ status: 'awaiting_context', label: 'Add business context' },
	{ status: 'finalizing', label: 'Generate RULES.md' },
	{ status: 'publishing', label: 'Publish the project' },
];

const BUSINESS_CONTEXT_REQUESTED_STATUSES: SetupStatus[] = ['syncing', 'registering', 'awaiting_context'];

interface WarehouseSetupProgressProps {
	job: WarehouseSetupJob;
	onRetry: () => void;
	onEdit: () => void;
	isRetrying: boolean;
	retryError: string | null;
	onSkipBusinessContext: () => void;
	isBusinessContextSkipped: boolean;
}

export function WarehouseSetupProgress({
	job,
	onRetry,
	onEdit,
	isRetrying,
	retryError,
	onSkipBusinessContext,
	isBusinessContextSkipped,
}: WarehouseSetupProgressProps) {
	return (
		<div className='flex flex-col gap-4'>
			<ol aria-label='Warehouse setup steps' className='flex flex-col gap-2.5'>
				{SETUP_STEPS.map((step, index) => (
					<SetupStepItem
						key={step.status}
						step={step}
						state={getStepState(job, index)}
						job={job}
						action={
							step.status === 'awaiting_context' && isBusinessContextRequested(job) ? (
								<BusinessContextAction
									onSkip={onSkipBusinessContext}
									isSkipped={isBusinessContextSkipped}
								/>
							) : null
						}
					/>
				))}
			</ol>
			{isStoppedStatus(job.status) && (
				<SetupFailure
					job={job}
					onRetry={onRetry}
					onEdit={onEdit}
					isRetrying={isRetrying}
					retryError={retryError}
				/>
			)}
		</div>
	);
}

function SetupStepItem({
	step,
	state,
	job,
	action,
}: {
	step: SetupStep;
	state: StepState;
	job: WarehouseSetupJob;
	action: React.ReactNode;
}) {
	const logs = job.logs?.trim();
	const showLogs = Boolean(step.command && logs && (state === 'active' || state === 'failed'));

	return (
		<li className='flex flex-col gap-1.5' aria-current={state === 'active' ? 'step' : undefined}>
			<div className='flex min-w-0 items-center gap-2 text-sm'>
				<StepIcon state={state} />
				<span
					className={cn(
						'truncate',
						state === 'pending' && 'text-muted-foreground',
						state === 'failed' && 'text-destructive',
					)}
				>
					{step.label}
				</span>
				{step.command && (
					<code className='shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground'>
						{step.command}
					</code>
				)}
				{action ??
					(state === 'active' && (
						<span className='ml-auto shrink-0 text-xs text-muted-foreground'>
							{getActiveStepDetail(step, job)}
						</span>
					))}
			</div>
			{showLogs && (
				<details open={state === 'failed'} className='group ml-6'>
					<summary className='flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground'>
						<Terminal className='size-3' />
						View {step.command} logs
					</summary>
					<pre className='mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground'>
						{logs}
					</pre>
				</details>
			)}
		</li>
	);
}

function BusinessContextAction({ onSkip, isSkipped }: { onSkip: () => void; isSkipped: boolean }) {
	if (isSkipped) {
		return <span className='ml-auto shrink-0 text-xs text-muted-foreground'>Skipped</span>;
	}
	return (
		<div className='ml-auto flex shrink-0 items-center gap-2'>
			<span className='text-xs text-muted-foreground'>Answer in the chat</span>
			<Button variant='outline' size='sm' className='h-6 rounded-full px-2.5 text-xs' onClick={onSkip}>
				Skip for now
			</Button>
		</div>
	);
}

function StepIcon({ state }: { state: StepState }) {
	if (state === 'done') {
		return <CheckCircle2 aria-label='Done' className='size-4 shrink-0 text-emerald-600 dark:text-emerald-400' />;
	}
	if (state === 'active') {
		return <Loader2 aria-label='In progress' className='size-4 shrink-0 animate-spin text-violet' />;
	}
	if (state === 'failed') {
		return <CircleAlert aria-label='Failed' className='size-4 shrink-0 text-destructive' />;
	}
	return <Circle aria-label='Pending' className='size-4 shrink-0 text-muted-foreground/50' />;
}

function SetupFailure({
	job,
	onRetry,
	onEdit,
	isRetrying,
	retryError,
}: Pick<WarehouseSetupProgressProps, 'job' | 'onRetry' | 'onEdit' | 'isRetrying' | 'retryError'>) {
	return (
		<div role='alert' className='flex flex-col gap-3 rounded-lg bg-destructive/5 p-3'>
			<div className='flex flex-col gap-0.5'>
				<span className='text-sm font-medium'>
					{job.status === 'cancelled' ? 'The setup was cancelled' : 'The setup stopped'}
				</span>
				<span className='text-xs text-muted-foreground'>{job.error ?? 'Warehouse setup failed.'}</span>
				{job.cause && (
					<details className='mt-1'>
						<summary className='cursor-pointer list-none text-[11px] text-muted-foreground hover:text-foreground'>
							View technical details
						</summary>
						<pre className='mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground'>
							{job.cause}
						</pre>
					</details>
				)}
				{retryError && <span className='text-xs text-destructive'>{retryError}</span>}
			</div>
			<div className='flex flex-wrap justify-end gap-2'>
				<Button variant='outline' size='sm' className='rounded-full' onClick={onEdit}>
					Edit connection details
				</Button>
				{job.canRetry && (
					<Button
						size='sm'
						className='rounded-full'
						onClick={onRetry}
						isLoading={isRetrying}
						disabled={isRetrying}
					>
						Retry
					</Button>
				)}
			</div>
		</div>
	);
}

function getStepState(job: WarehouseSetupJob, stepIndex: number): StepState {
	if (job.status === 'ready') {
		return 'done';
	}

	const isStopped = isStoppedStatus(job.status);
	const currentStatus = isStopped ? job.failedStatus : job.status;
	const currentIndex = SETUP_STEPS.findIndex((step) => step.status === currentStatus);
	if (SETUP_STEPS[stepIndex].status === 'awaiting_context' && job.businessContextProvided) {
		return 'done';
	}
	if (stepIndex === currentIndex) {
		return isStopped ? 'failed' : 'active';
	}
	return stepIndex < currentIndex ? 'done' : 'pending';
}

function getActiveStepDetail(step: SetupStep, job: WarehouseSetupJob): string {
	if (step.status === 'awaiting_context') {
		return 'Answer in the chat';
	}
	if (step.status === 'syncing') {
		const percentage = getLatestPercentage(job.logs);
		return percentage === null ? 'In progress' : `${percentage}%`;
	}
	return 'In progress';
}

export function describeCurrentSetupStep(job: WarehouseSetupJob): string {
	if (job.status === 'ready') {
		return 'Setup complete';
	}
	const isStopped = isStoppedStatus(job.status);
	const step = SETUP_STEPS.find((candidate) => candidate.status === (isStopped ? job.failedStatus : job.status));
	if (!step) {
		return isStopped ? 'Setup stopped' : 'In progress';
	}
	if (isStopped) {
		return `Stopped at: ${step.label}`;
	}
	return step.status === 'syncing' || step.status === 'awaiting_context'
		? `${step.label} · ${getActiveStepDetail(step, job)}`
		: step.label;
}

export function isBusinessContextRequested(job: WarehouseSetupJob): boolean {
	return !job.businessContextProvided && BUSINESS_CONTEXT_REQUESTED_STATUSES.includes(job.status);
}

export function isStoppedStatus(status: SetupStatus): boolean {
	return status === 'failed' || status === 'cancelled';
}
