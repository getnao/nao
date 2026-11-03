import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';

import type { TrpcRouter } from '@nao/backend/trpc';
import type { UIMessage } from '@nao/backend/chat';

import { Button } from '@/components/ui/button';
import { useAgentContext, useAgentMessages } from '@/contexts/agent.provider';
import { useRestartOnboarding } from '@/contexts/onboarding-restart';
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
	canRestart = false,
}: {
	complete?: boolean;
	warehouseStatus?: WarehouseProvisioningStatus;
	canRestart?: boolean;
}) {
	const progress = useOnboardingProgress();
	const steps = progress ? ONBOARDING_STEPS[progress.flow] : [''];
	const completedSteps = getCompletedSteps(progress, steps.length, complete, warehouseStatus);

	return (
		<div className='flex flex-col'>
			<div className='mb-2 flex items-center justify-between gap-4'>
				<span className='text-sm font-medium'>Onboarding progress</span>
				<div className='flex min-w-0 items-center gap-3'>
					<span className='text-xs text-muted-foreground'>
						{progress ? `${completedSteps} of ${steps.length} complete` : 'Choose your setup path'}
					</span>
					{canRestart && <RestartOnboardingControl />}
				</div>
			</div>
			<div
				role='progressbar'
				aria-label='Onboarding progress'
				aria-valuemin={0}
				aria-valuemax={steps.length}
				aria-valuenow={completedSteps}
			>
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
		</div>
	);
}

function RestartOnboardingControl() {
	const { isRunning } = useAgentContext();
	const { restart, isPending, error } = useRestartOnboarding();
	const [isConfirming, setIsConfirming] = useState(false);

	if (!isConfirming) {
		return (
			<Button
				variant='ghost'
				size='sm'
				className='h-7 rounded-full px-2.5 text-xs text-muted-foreground'
				disabled={isRunning}
				title={isRunning ? 'Wait for the onboarding agent to finish replying' : undefined}
				onClick={() => setIsConfirming(true)}
			>
				<RotateCcw className='size-3' />
				Start over
			</Button>
		);
	}

	return (
		<div role='group' aria-label='Restart the onboarding' className='flex items-center gap-1.5'>
			<span className={cn('truncate text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>
				{error ? error.message : 'Cancel the current setup and start over?'}
			</span>
			<Button
				variant='ghost'
				size='sm'
				className='h-7 rounded-full px-2.5 text-xs'
				disabled={isPending}
				onClick={() => setIsConfirming(false)}
			>
				Keep going
			</Button>
			<Button
				variant='destructive'
				size='sm'
				className='h-7 rounded-full px-2.5 text-xs'
				isLoading={isPending}
				disabled={isPending || isRunning}
				onClick={() => restart().catch(console.error)}
			>
				Start over
			</Button>
		</div>
	);
}

export function useOnboardingProgress() {
	const messages = useAgentMessages();
	return useMemo(() => findLatestProgress(messages), [messages]);
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

export function isDeployStepReached(progress: OnboardingProgressState | null): boolean {
	return (progress?.flow === 'new' || progress?.flow === 'local') && progress.step >= 3;
}

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
	projectSetupComplete: boolean,
	progress: OnboardingProgressState | null,
	warehouseReady: boolean,
	warehouseProvisioningActive?: boolean,
): boolean {
	const progressComplete = isDeployStepReached(progress) || (progress?.flow === 'github' && progress.step === 2);
	return projectSetupComplete && (warehouseReady || progressComplete || warehouseProvisioningActive === false);
}

export function findCreatedOnboardingProject<T extends { createdAt: Date }>(
	projects: T[] | undefined,
	onboardingStartedAt: number | undefined,
): T | null {
	if (onboardingStartedAt === undefined) {
		return null;
	}
	return projects?.find((project) => project.createdAt.getTime() >= onboardingStartedAt) ?? null;
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

export function getLatestPercentage(logs?: string | null): number | null {
	const matches = [...(logs ?? '').matchAll(/(\d{1,3})%/g)];
	const percentage = Number(matches.at(-1)?.[1]);
	return Number.isFinite(percentage) ? Math.min(Math.max(percentage, 0), 100) : null;
}
