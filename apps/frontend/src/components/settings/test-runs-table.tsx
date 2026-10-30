import type { TestRunSummary } from '@/components/settings/test-run-types';
import { formatCost, formatPassRate, onEnterOrSpace } from '@/components/settings/test-run-types';
import { Badge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const STATUS_BADGES: Record<
	TestRunSummary['status'],
	{ label: string; variant: 'secondary' | 'success' | 'error' | 'viewer' }
> = {
	queued: { label: 'Queued', variant: 'secondary' },
	running: { label: 'Running', variant: 'secondary' },
	completed: { label: 'Completed', variant: 'success' },
	failed: { label: 'Failed', variant: 'error' },
	cancelled: { label: 'Cancelled', variant: 'viewer' },
};

interface TestRunsTableProps {
	runs: TestRunSummary[];
	selectedRunId: string | undefined;
	onSelectRun: (runId: string) => void;
}

export function TestRunsTable({ runs, selectedRunId, onSelectRun }: TestRunsTableProps) {
	if (runs.length === 0) {
		return <Empty className='py-6'>No runs yet.</Empty>;
	}

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Started</TableHead>
					<TableHead>Status</TableHead>
					<TableHead>Tests</TableHead>
					<TableHead>Passed</TableHead>
					<TableHead>Cost</TableHead>
					<TableHead>By</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{runs.map((run) => (
					<TableRow
						key={run.id}
						tabIndex={0}
						aria-selected={run.id === selectedRunId}
						onClick={() => onSelectRun(run.id)}
						onKeyDown={onEnterOrSpace(() => onSelectRun(run.id))}
						className={cn('cursor-pointer', run.id === selectedRunId && 'bg-muted/50')}
					>
						<TableCell className='text-xs'>{new Date(run.createdAt).toLocaleString()}</TableCell>
						<TableCell>
							<TestRunStatusBadge status={run.status} />
						</TableCell>
						<TableCell className='text-xs text-muted-foreground'>{run.selection?.length ?? '—'}</TableCell>
						<TableCell className='text-xs'>
							{formatPassRate(run.passedAttempts, run.completedAttempts)}
							<span className='text-muted-foreground'>
								{' '}
								({run.passedAttempts}/{run.totalAttempts})
							</span>
						</TableCell>
						<TableCell className='text-xs text-muted-foreground'>{formatCost(run.totalCost)}</TableCell>
						<TableCell className='text-xs text-muted-foreground'>{run.triggeredByName ?? '—'}</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

export function TestRunStatusBadge({ status }: { status: TestRunSummary['status'] }) {
	const badge = STATUS_BADGES[status];
	return <Badge variant={badge.variant}>{badge.label}</Badge>;
}
