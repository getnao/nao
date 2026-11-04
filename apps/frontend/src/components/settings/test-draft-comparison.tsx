import { CircleDashed } from 'lucide-react';

import type { ComponentProps } from 'react';

import type { DraftContext, TestComparisonChange, VariantOutcome } from '@/components/settings/test-run-types';
import type { Tone } from '@/components/settings/test-run-verdict';
import { TONE_COLORS, TONE_LABELS, ToneIcon } from '@/components/settings/test-run-labels';
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

/** The outcome of one side of a comparison as an icon, with the pass count when the test ran several times. */
export function VariantOutcomeCell({
	side,
	outcome,
	attemptsPerVariant,
}: {
	side: string;
	outcome: VariantOutcome;
	attemptsPerVariant: number;
}) {
	if (outcome.totalAttempts === 0) {
		return (
			<CircleDashed
				aria-label={`${side}: waiting`}
				className='inline size-3.5 align-middle text-muted-foreground'
			/>
		);
	}
	const tone = outcomeTone(outcome.passedAttempts, outcome.totalAttempts);
	const passCount = `${outcome.passedAttempts}/${attemptsPerVariant}`;
	const title = `${side}: ${attemptsPerVariant === 1 ? TONE_LABELS[tone].toLowerCase() : `${passCount} passed`}`;
	return (
		<span
			role='img'
			title={title}
			aria-label={title}
			className={cn('inline-flex items-center gap-1 align-middle text-xs tabular-nums', TONE_COLORS[tone])}
		>
			<ToneIcon tone={tone} />
			{attemptsPerVariant > 1 && passCount}
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
