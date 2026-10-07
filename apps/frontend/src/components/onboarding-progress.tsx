import { useMemo } from 'react';
import type { UIMessage } from '@nao/backend/chat';

import { useAgentMessages } from '@/contexts/agent.provider';
import { cn } from '@/lib/utils';

const ONBOARDING_STEPS = {
	new: ['Install', 'Initialize', 'Verify & sync', 'Deploy'],
	local: ['Locate project', 'Verify', 'Sync', 'Deploy'],
	github: ['Connect GitHub', 'Import repository'],
	database: ['Connect warehouse', 'Initialize', 'Sync metadata', 'Prepare context'],
} as const;

export function OnboardingProgress({ complete = false }: { complete?: boolean }) {
	const progress = useOnboardingProgress();
	const steps = progress ? ONBOARDING_STEPS[progress.flow] : [''];
	const completedSteps = complete ? steps.length : Math.min(progress?.step ?? 0, steps.length);

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
								index < completedSteps ? 'bg-emerald-500' : 'bg-muted',
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

type OnboardingProgressState = {
	flow: keyof typeof ONBOARDING_STEPS;
	step: number;
};

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
