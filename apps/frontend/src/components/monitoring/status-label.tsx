import { Ban, CircleCheck, CircleX, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AutomationRunStatus } from '@nao/backend/monitoring';
import { cn } from '@/lib/utils';

export type StatusTone = 'success' | 'error' | 'warning' | 'running' | 'neutral';

interface StatusDisplay {
	tone: StatusTone;
	label: string;
}

const TONE_ICONS: Record<StatusTone, LucideIcon> = {
	success: CircleCheck,
	error: CircleX,
	warning: TriangleAlert,
	running: LoaderCircle,
	neutral: Ban,
};

const TONE_CLASSES: Record<StatusTone, string> = {
	success: 'text-green-600 dark:text-green-500',
	error: 'text-destructive',
	warning: 'text-amber-600 dark:text-amber-500',
	running: 'text-primary animate-spin',
	neutral: 'text-muted-foreground',
};

export const RUN_STATUS_DISPLAY: Record<AutomationRunStatus, StatusDisplay> = {
	completed: { tone: 'success', label: 'OK' },
	failed: { tone: 'error', label: 'Failed' },
	running: { tone: 'running', label: 'Running' },
	cancelled: { tone: 'neutral', label: 'Cancelled' },
};

export function StatusLabel({ tone, label, className }: { tone: StatusTone; label: string; className?: string }) {
	return (
		<span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', className)}>
			<StatusIcon tone={tone} />
			<span>{label}</span>
		</span>
	);
}

export function StatusIcon({ tone, className }: { tone: StatusTone; className?: string }) {
	const Icon = TONE_ICONS[tone];
	return <Icon aria-hidden='true' className={cn('size-3.5 shrink-0', TONE_CLASSES[tone], className)} />;
}

export function RunStatusLabel({ status, className }: { status: AutomationRunStatus; className?: string }) {
	const display = RUN_STATUS_DISPLAY[status];
	return <StatusLabel tone={display.tone} label={display.label} className={className} />;
}
