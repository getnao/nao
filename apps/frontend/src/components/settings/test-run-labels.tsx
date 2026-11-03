import { CircleCheck, CircleDashed, CircleMinus, CircleX, GitBranch } from 'lucide-react';

import type { ReactNode } from 'react';

import type { Tone } from '@/components/settings/test-run-verdict';
import type { DraftContext, TestRunResult } from '@/components/settings/test-run-types';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

const DEFAULT_MAIN_BRANCH = 'main';
const CHANGES_FALLBACK = 'your changes';

const TONE_COLORS: Record<Tone, string> = {
	pass: 'text-green-600 dark:text-green-500',
	fail: 'text-destructive',
	mixed: 'text-amber-600 dark:text-amber-500',
	pending: 'text-muted-foreground',
	neutral: 'text-muted-foreground',
};

/** The two sides of a comparison, named after their branches as in the Recent runs list. */
export interface RunBranches {
	main: string;
	changes: string;
}

export function getRunBranches(run: { contextRef?: string | null }, draft: DraftContext | null): RunBranches {
	return {
		main: draft?.productionBranch ?? DEFAULT_MAIN_BRANCH,
		changes: run.contextRef ?? draft?.branch ?? CHANGES_FALLBACK,
	};
}

/** A git branch, inline with the text around it so that its monospace name sits on the same baseline. */
export function BranchName({ name, className }: { name: string; className?: string }) {
	return (
		<span className={cn('whitespace-nowrap', className)}>
			<GitBranch aria-hidden className='mr-0.5 inline size-3 align-[-2px]' />
			<span className='font-mono text-[0.92em] text-foreground'>{name}</span>
		</span>
	);
}

/** The title of one side of a compared attempt: whether it passed, on which branch, and what follows. */
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

export function ToneIcon({ tone, className }: { tone: Tone; className?: string }) {
	if (tone === 'pending') {
		return <Spinner className={cn('size-3.5 shrink-0', className)} />;
	}
	const Icon = { pass: CircleCheck, fail: CircleX, mixed: CircleDashed, neutral: CircleMinus }[tone];
	return <Icon className={cn('size-3.5 shrink-0', TONE_COLORS[tone], className)} />;
}
