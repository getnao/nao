import { CircleCheck, CircleDashed, CircleMinus, CircleStop, CircleX, GitBranch, TriangleAlert } from 'lucide-react';

import type { ReactNode } from 'react';

import type { Tone } from '@/components/settings/test-run-verdict';
import type { DraftContext, TestRunResult } from '@/components/settings/test-run-types';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

const DEFAULT_MAIN_BRANCH = 'main';
/** Names the branch of the user's changes when the context has no git repository. */
export const CHANGES_FALLBACK = 'your changes';

export const TONE_COLORS: Record<Tone, string> = {
	pass: 'text-green-600 dark:text-green-500',
	fail: 'text-destructive',
	mixed: 'text-amber-600 dark:text-amber-500',
	pending: 'text-muted-foreground',
	neutral: 'text-muted-foreground',
	cancelled: 'text-muted-foreground',
	error: 'text-destructive',
};

export const TONE_LABELS: Record<Tone, string> = {
	pass: 'Passed',
	fail: 'Failed',
	mixed: 'Flaky',
	pending: 'Running',
	neutral: 'No result',
	cancelled: 'Cancelled',
	error: 'Error',
};

const TONE_ICONS = {
	pass: CircleCheck,
	fail: CircleX,
	mixed: CircleDashed,
	neutral: CircleMinus,
	cancelled: CircleStop,
	error: TriangleAlert,
} as const;

export interface RunBranches {
	main: string;
	changes: string;
}

export function getRunBranches(run: { contextRef?: string | null }, draft: DraftContext | null): RunBranches {
	return {
		main: getMainBranch(draft),
		changes: run.contextRef ?? draft?.branch ?? CHANGES_FALLBACK,
	};
}

/** The configured default branch of the context, `main` when the context has no git repository. */
export function getMainBranch(draft: DraftContext | null): string {
	return draft?.productionBranch ?? DEFAULT_MAIN_BRANCH;
}

/** A git branch, inline with the text around it so that its monospace name sits on the same baseline. */
export function BranchName({ name, className }: { name: string; className?: string }) {
	return (
		<span className='whitespace-nowrap'>
			<GitBranch aria-hidden className='mr-0.5 inline size-3 align-[-2px]' />
			<BranchCode name={name} className={cn('text-foreground', className)} />
		</span>
	);
}

export function BranchCode({ name, className }: { name: string; className?: string }) {
	return <span className={cn('font-mono text-[0.92em]', className)}>{name}</span>;
}

export function AttemptSideHeader({
	result,
	branch,
	children,
}: {
	result: TestRunResult | null;
	branch: string;
	children?: ReactNode;
}) {
	return (
		<div className='flex min-w-0 shrink-0 items-center gap-1.5 font-medium'>
			<ToneIcon tone={result ? (result.passed ? 'pass' : 'fail') : 'neutral'} />
			<BranchName name={branch} />
			{children && (
				<span className='ml-auto flex items-center gap-1 font-normal text-muted-foreground'>{children}</span>
			)}
		</div>
	);
}

/** A pass, fail or flaky outcome at a glance, or a run still going or stopped, named when no text says it. */
export function ToneIcon({
	tone,
	isLabelled = false,
	className,
}: {
	tone: Tone;
	isLabelled?: boolean;
	className?: string;
}) {
	if (tone === 'pending') {
		return <Spinner className={cn('size-3.5 shrink-0', className)} />;
	}
	const Icon = TONE_ICONS[tone];
	return (
		<Icon
			aria-label={isLabelled ? TONE_LABELS[tone] : undefined}
			className={cn('size-3.5 shrink-0', TONE_COLORS[tone], className)}
		/>
	);
}
