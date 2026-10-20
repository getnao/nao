import { useMemo } from 'react';
import { Loader2, Terminal } from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';

import type { TrpcRouter } from '@nao/backend/trpc';
import type { UIMessage } from '@nao/backend/chat';

import { useAgentMessages } from '@/contexts/agent.provider';
import { cn } from '@/lib/utils';

const ONBOARDING_STEPS = {
	new: ['Install', 'Initialize', 'Verify & sync', 'Deploy'],
	local: ['Locate project', 'Verify', 'Sync', 'Deploy'],
	github: ['Connect GitHub', 'Import repository'],
	database: ['Connect warehouse', 'Initialize', 'Verify', 'Sync metadata', 'Prepare context'],
} as const;

type WarehouseProvisioningStatus =
	inferRouterOutputs<TrpcRouter>['onboarding']['getWarehouseProvisioningStatus']['status'];

const DATABASE_COMPLETED_STEPS: Partial<Record<WarehouseProvisioningStatus, number>> = {
	queued: 1,
	initializing: 1,
	debugging: 2,
	syncing: 3,
	registering: 4,
	awaiting_context: 4,
	finalizing: 4,
	publishing: 4,
	ready: 5,
};

export function OnboardingProgress({
	complete = false,
	warehouseStatus,
}: {
	complete?: boolean;
	warehouseStatus?: WarehouseProvisioningStatus;
}) {
	const progress = useOnboardingProgress();
	const steps = progress ? ONBOARDING_STEPS[progress.flow] : [''];
	const completedSteps = getCompletedSteps(progress, steps.length, complete, warehouseStatus);

	return (
		<div
			role='progressbar'
			aria-label='Onboarding progress'
			aria-valuemin={0}
			aria-valuemax={steps.length}
			aria-valuenow={completedSteps}
		>
			<div className='mb-2 flex items-center justify-between gap-4'>
				<span className='text-sm font-medium'>Onboarding progress</span>
				<span className='text-xs text-muted-foreground'>
					{progress ? `${completedSteps} of ${steps.length} complete` : 'Choose your setup path'}
				</span>
			</div>
			<div className='flex gap-2'>
				{steps.map((label, index) => (
					<div key={label} className='min-w-0 flex-1'>
						<div
							className={cn(
								'h-1.5 rounded-full transition-colors',
								index < completedSteps ? 'bg-violet' : 'bg-muted',
							)}
						/>
						<span className='mt-1 block truncate text-xs text-muted-foreground'>{label}</span>
					</div>
				))}
			</div>
		</div>
	);
}

export function useOnboardingProgress() {
	const messages = useAgentMessages();
	return useMemo(() => findLatestProgress(messages), [messages]);
}

export function WarehouseCommandProgress({
	status,
	logs,
}: {
	status?: WarehouseProvisioningStatus;
	logs?: string | null;
}) {
	if (status !== 'debugging' && status !== 'syncing') {
		return null;
	}

	const isSyncing = status === 'syncing';
	const syncProgress = isSyncing ? getLatestPercentage(logs) : null;
	const progress = isSyncing ? (syncProgress ?? 50) : 25;
	const label = isSyncing ? 'Syncing schema and previews' : 'Checking your warehouse connection';

	return (
		<div className='rounded-xl border border-violet/20 bg-background/95 px-4 py-3 shadow-sm backdrop-blur'>
			<div className='flex items-center justify-between gap-3'>
				<div className='flex min-w-0 items-center gap-2'>
					<Loader2 className='size-3.5 shrink-0 animate-spin text-violet' />
					<span className='truncate text-xs font-medium'>{label}</span>
				</div>
				<span className='shrink-0 text-[11px] text-muted-foreground'>
					{syncProgress === null ? 'In progress' : `${syncProgress}%`}
				</span>
			</div>
			<div
				role='progressbar'
				aria-label={label}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={syncProgress ?? undefined}
				className='mt-2 h-1.5 overflow-hidden rounded-full bg-muted'
			>
				<div
					className={cn(
						'h-full rounded-full bg-violet transition-[width] duration-300',
						!syncProgress && 'animate-pulse',
					)}
					style={{ width: `${progress}%` }}
				/>
			</div>
			{logs?.trim() && (
				<details className='group mt-2'>
					<summary className='flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground'>
						<Terminal className='size-3' />
						View nao {isSyncing ? 'sync' : 'debug'} logs
					</summary>
					<pre className='mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground'>
						{logs}
					</pre>
				</details>
			)}
		</div>
	);
}

export function findWarehouseJobId(messages: UIMessage[]): string | null {
	for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
		const parts = messages[messageIndex].parts;
		for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
			const part = parts[partIndex];
			if (part.type === 'tool-generate_onboarding_rules' && part.state === 'output-available') {
				return part.output.jobId;
			}
		}
	}
	return null;
}

export type OnboardingProgressState = {
	flow: keyof typeof ONBOARDING_STEPS;
	step: number;
};

export function getCompletedSteps(
	progress: OnboardingProgressState | null,
	stepCount: number,
	complete: boolean,
	warehouseStatus?: WarehouseProvisioningStatus,
): number {
	if (complete) {
		return stepCount;
	}
	const reportedSteps =
		progress?.flow === 'database' && warehouseStatus
			? Math.max(progress.step, DATABASE_COMPLETED_STEPS[warehouseStatus] ?? 0)
			: (progress?.step ?? 0);
	const maximumSteps =
		progress?.flow === 'database' && warehouseStatus === 'ready' ? stepCount : Math.max(stepCount - 1, 0);
	return Math.min(reportedSteps, maximumSteps);
}

export function isOnboardingComplete(
	hasProject: boolean,
	progress: OnboardingProgressState | null,
	warehouseReady: boolean,
): boolean {
	const progressComplete =
		((progress?.flow === 'new' || progress?.flow === 'local') && progress.step === 4) ||
		(progress?.flow === 'github' && progress.step === 2);
	return hasProject && (warehouseReady || progressComplete);
}

function findLatestProgress(messages: UIMessage[]): OnboardingProgressState | null {
	for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
		const parts = messages[messageIndex].parts;
		for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
			const part = parts[partIndex];
			if (part.type === 'tool-onboarding_progress' && part.state === 'output-available') {
				return part.output;
			}
		}
	}
	return null;
}

function getLatestPercentage(logs?: string | null): number | null {
	const matches = [...(logs ?? '').matchAll(/(\d{1,3})%/g)];
	const percentage = Number(matches.at(-1)?.[1]);
	return Number.isFinite(percentage) ? Math.min(Math.max(percentage, 0), 100) : null;
}
