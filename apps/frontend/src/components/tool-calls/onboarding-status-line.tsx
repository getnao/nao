import { CheckCircle2, Clock, RotateCcw } from 'lucide-react';

import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

export type OnboardingStatusTone = 'running' | 'success' | 'error' | 'neutral' | 'restarted';

interface OnboardingStatusLineProps {
	tone: OnboardingStatusTone;
	label: string;
	detail?: string | null;
}

export function OnboardingStatusLine({ tone, label, detail }: OnboardingStatusLineProps) {
	return (
		<div role={tone === 'error' ? 'alert' : undefined} className='flex min-w-0 flex-col gap-0.5'>
			<div className='flex min-w-0 items-center gap-2'>
				<div className='flex size-3 shrink-0 items-center justify-center'>
					<StatusIcon tone={tone} />
				</div>
				<span className={cn('truncate text-sm', tone === 'running' && 'text-shimmer')}>{label}</span>
			</div>
			{detail && <p className='pl-5 text-xs leading-relaxed text-muted-foreground'>{detail}</p>}
		</div>
	);
}

function StatusIcon({ tone }: { tone: OnboardingStatusTone }) {
	if (tone === 'running') {
		return <Spinner className='size-3 opacity-50' />;
	}
	if (tone === 'success') {
		return <CheckCircle2 className='size-3 text-emerald-600 dark:text-emerald-400' />;
	}
	if (tone === 'error') {
		return <div className='size-2 rounded-full bg-destructive' />;
	}
	if (tone === 'restarted') {
		return <RotateCcw className='size-3 text-muted-foreground' />;
	}
	return <Clock className='size-3 text-muted-foreground' />;
}
