import { CircleCheck, CircleDashed, CircleX } from 'lucide-react';

import type { DraftContext, TestComparison, TestComparisonChange } from '@/components/settings/test-run-types';
import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/ui/callout';
import { cn } from '@/lib/utils';

type VariantOutcome = TestComparison['production'];

const CHANGE_BADGES: Record<
	TestComparisonChange,
	{ label: string; variant: 'success' | 'error' | 'viewer' | 'secondary' }
> = {
	regressed: { label: 'Regressed', variant: 'error' },
	worsened: { label: 'Less reliable', variant: 'error' },
	fixed: { label: 'Fixed', variant: 'success' },
	improved: { label: 'More reliable', variant: 'success' },
	unchanged: { label: 'No change', variant: 'viewer' },
	pending: { label: 'Running', variant: 'secondary' },
};

/** How the user's changes moved a test, from its attempts on production and with the changes. */
export function ComparisonChangeBadge({ change, isActive }: { change: TestComparisonChange; isActive: boolean }) {
	const badge = CHANGE_BADGES[change];
	return <Badge variant={badge.variant}>{change === 'pending' && !isActive ? 'Incomplete' : badge.label}</Badge>;
}

/** The attempts of a test that passed against one context, or that it still waits for them. */
export function VariantOutcomeCell({
	outcome,
	attemptsPerVariant,
}: {
	outcome: VariantOutcome;
	attemptsPerVariant: number;
}) {
	if (outcome.total === 0) {
		return (
			<span className='flex items-center gap-1 text-xs text-muted-foreground'>
				<CircleDashed className='size-3.5' />
				Waiting
			</span>
		);
	}
	const allPassed = outcome.passed === outcome.total;
	const nonePassed = outcome.passed === 0;
	const Icon = allPassed ? CircleCheck : nonePassed ? CircleX : CircleDashed;
	return (
		<span
			className={cn(
				'flex items-center gap-1 text-xs',
				allPassed && 'text-green-600 dark:text-green-500',
				nonePassed && 'text-destructive',
				!allPassed && !nonePassed && 'text-amber-600 dark:text-amber-500',
			)}
		>
			<Icon className='size-3.5 shrink-0' />
			{attemptsPerVariant === 1 ? (allPassed ? 'Passed' : 'Failed') : `${outcome.passed}/${outcome.total} passed`}
		</span>
	);
}

export function hasDraftContextWarnings(draft: DraftContext): boolean {
	return draft.outdatedPaths.length > 0 || draft.excludedChanges.length > 0;
}

/** What makes a comparison with production unfair or partial, so the user can fix it before running one. */
export function DraftContextWarnings({ draft, className }: { draft: DraftContext; className?: string }) {
	return (
		<>
			{draft.outdatedPaths.length > 0 && (
				<Callout variant='warning' className={className}>
					Production changed {draft.outdatedPaths.join(', ')} since your changes started, so the comparison
					would also undo those updates.{' '}
					{draft.storage === 'git'
						? 'Update the File Explorer first for a fair comparison.'
						: 'Discard your draft of these files and redo the edits on the latest version for a fair comparison.'}
				</Callout>
			)}
			{draft.excludedChanges.length > 0 && (
				<Callout className={className}>
					Changes to {draft.excludedChanges.map((change) => change.path).join(', ')} are not tested:
					connections, MCP servers and skills always come from production.
				</Callout>
			)}
		</>
	);
}
