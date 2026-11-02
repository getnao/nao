import { Link } from '@tanstack/react-router';
import { GitCompareArrows } from 'lucide-react';

import type { DraftContext } from '@/components/settings/test-run-types';
import { ContextChangeItem } from '@/components/settings/test-comparison-results';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Spinner } from '@/components/ui/spinner';

const MAX_LISTED_CHANGES = 8;

interface DraftComparisonCardProps {
	draft: DraftContext;
	testCount: number;
	isStarting: boolean;
	isDisabled: boolean;
	onCompare: () => void;
}

export function DraftComparisonCard({ draft, testCount, isStarting, isDisabled, onCompare }: DraftComparisonCardProps) {
	const hiddenCount = draft.changes.length - MAX_LISTED_CHANGES;
	return (
		<div className='flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4'>
			<div className='flex items-start justify-between gap-4'>
				<div className='flex min-w-0 flex-1 flex-col gap-0.5'>
					<span className='flex items-center gap-2 text-sm font-semibold text-foreground'>
						<GitCompareArrows className='size-4 text-primary' />
						Test your context changes
					</span>
					<span className='text-xs text-muted-foreground'>
						{draft.changes.length} changed file{draft.changes.length === 1 ? '' : 's'} in{' '}
						{draft.storage === 'nao' ? 'your draft in the ' : 'the '}
						<Link to='/settings/context-explorer' className='underline'>
							File Explorer
						</Link>
						{draft.branch && (
							<>
								{' '}
								on <span className='font-mono text-foreground'>{draft.branch}</span>
							</>
						)}
						. Run {testCount} test{testCount === 1 ? '' : 's'} on production and on your changes side by
						side.
					</span>
				</div>
				<Button
					size='sm'
					className='shrink-0'
					onClick={onCompare}
					disabled={isDisabled || isStarting || testCount === 0}
				>
					{isStarting ? <Spinner className='size-4' /> : <GitCompareArrows className='size-4' />}
					Compare with production
				</Button>
			</div>
			<div className='flex flex-wrap gap-x-4 gap-y-1 text-xs'>
				{draft.changes.slice(0, MAX_LISTED_CHANGES).map((change) => (
					<ContextChangeItem key={change.path} change={change} />
				))}
				{hiddenCount > 0 && <span className='text-muted-foreground'>+{hiddenCount} more</span>}
			</div>
			<DraftContextWarnings draft={draft} />
		</div>
	);
}

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
