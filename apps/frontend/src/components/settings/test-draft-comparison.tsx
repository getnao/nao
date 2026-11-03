import { CircleDashed } from 'lucide-react';

import type { ComponentProps } from 'react';

import type { DraftContext, TestComparisonChange, VariantOutcome } from '@/components/settings/test-run-types';
import type { Tone } from '@/components/settings/test-run-verdict';
import { TONE_COLORS, ToneIcon } from '@/components/settings/test-run-labels';
import { COMPARISON_CHANGES, outcomeTone } from '@/components/settings/test-run-verdict';
import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/ui/callout';
import { cn } from '@/lib/utils';

type BadgeVariant = ComponentProps<typeof Badge>['variant'];

const TONE_BADGES: Record<Tone, BadgeVariant> = {
	pass: 'success',
	fail: 'error',
	mixed: 'context_admin',
	pending: 'secondary',
	neutral: 'viewer',
	cancelled: 'viewer',
	error: 'error',
};

const RUNNING_CHANGE = { tone: 'pending', label: 'Running' } as const;

export function ComparisonChangeBadge({ change, isActive }: { change: TestComparisonChange; isActive: boolean }) {
	const { tone, label } = change === 'pending' && isActive ? RUNNING_CHANGE : COMPARISON_CHANGES[change];
	return <Badge variant={TONE_BADGES[tone]}>{label}</Badge>;
}

export function VariantOutcomeCell({
	outcome,
	attemptsPerVariant,
}: {
	outcome: VariantOutcome;
	attemptsPerVariant: number;
}) {
	if (outcome.totalAttempts === 0) {
		return (
			<span className='flex items-center gap-1 text-xs text-muted-foreground'>
				<CircleDashed className='size-3.5' />
				Waiting
			</span>
		);
	}
	const tone = outcomeTone(outcome.passedAttempts, outcome.totalAttempts);
	const label =
		attemptsPerVariant === 1
			? tone === 'pass'
				? 'Passed'
				: 'Failed'
			: `${outcome.passedAttempts}/${outcome.totalAttempts} passed`;
	return (
		<span className={cn('flex items-center gap-1 text-xs', TONE_COLORS[tone])}>
			<ToneIcon tone={tone} />
			{label}
		</span>
	);
}

export function hasDraftContextWarnings(draft: DraftContext): boolean {
	return draft.outdatedPaths.length > 0 || draft.excludedChanges.length > 0;
}

/** What makes a comparison with production unfair or partial, so the user can fix it before running one. */
export function DraftContextWarnings({ draft }: { draft: DraftContext }) {
	return (
		<>
			{draft.outdatedPaths.length > 0 && (
				<Callout variant='warning'>
					Production changed {draft.outdatedPaths.join(', ')} since your changes started, so the comparison
					would also undo those updates.{' '}
					{draft.storage === 'git'
						? 'Update the File Explorer first for a fair comparison.'
						: 'Discard your draft of these files and redo the edits on the latest version for a fair comparison.'}
				</Callout>
			)}
			{draft.excludedChanges.length > 0 && (
				<Callout>
					Changes to {draft.excludedChanges.map((change) => change.path).join(', ')} are not tested:
					connections, MCP servers and skills always come from production.
				</Callout>
			)}
		</>
	);
}
