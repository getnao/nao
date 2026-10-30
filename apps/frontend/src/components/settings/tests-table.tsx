import { CircleCheck, CircleDashed, CircleX, History } from 'lucide-react';

import type { LatestTestOutcome, TestDefinition } from '@/components/settings/test-run-types';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Empty } from '@/components/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface TestsTableProps {
	tests: TestDefinition[];
	latestOutcomes: Record<string, LatestTestOutcome>;
	selectedPaths: Set<string>;
	onSelectedPathsChange: (paths: Set<string>) => void;
	onOpenRun: (runId: string) => void;
}

export function TestsTable({
	tests,
	latestOutcomes,
	selectedPaths,
	onSelectedPathsChange,
	onOpenRun,
}: TestsTableProps) {
	if (tests.length === 0) {
		return <Empty className='py-6'>No tests match the selected tags.</Empty>;
	}

	const allSelected = tests.every((test) => selectedPaths.has(test.path));

	const toggleAll = () => {
		const next = new Set(selectedPaths);
		for (const test of tests) {
			if (allSelected) {
				next.delete(test.path);
			} else {
				next.add(test.path);
			}
		}
		onSelectedPathsChange(next);
	};

	const toggleTest = (path: string) => {
		const next = new Set(selectedPaths);
		if (!next.delete(path)) {
			next.add(path);
		}
		onSelectedPathsChange(next);
	};

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className='w-8'>
						<Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label='Select all tests' />
					</TableHead>
					<TableHead>Test</TableHead>
					<TableHead>Tags</TableHead>
					<TableHead>Owner</TableHead>
					<TableHead className='text-right'>Last result</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{tests.map((test) => (
					<TableRow key={test.path}>
						<TableCell>
							<Checkbox
								checked={selectedPaths.has(test.path)}
								onCheckedChange={() => toggleTest(test.path)}
								aria-label={`Select ${test.name}`}
							/>
						</TableCell>
						<TableCell className='max-w-[320px]'>
							<div className='truncate font-medium' title={test.prompt}>
								{test.name}
							</div>
							<div className='truncate text-xs text-muted-foreground'>tests/{test.path}</div>
						</TableCell>
						<TableCell>
							<div className='flex flex-wrap gap-1'>
								{test.tags.map((tag) => (
									<Badge key={tag} variant='outline'>
										{tag}
									</Badge>
								))}
							</div>
						</TableCell>
						<TableCell className='text-xs text-muted-foreground'>{test.owner ?? '—'}</TableCell>
						<TableCell className='text-right'>
							<LatestOutcome outcome={latestOutcomes[test.path]} onOpenRun={onOpenRun} />
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

function LatestOutcome({
	outcome,
	onOpenRun,
}: {
	outcome: LatestTestOutcome | undefined;
	onOpenRun: (runId: string) => void;
}) {
	if (!outcome || outcome.totalAttempts === 0) {
		return (
			<span className='inline-flex items-center gap-1 text-xs text-muted-foreground'>
				<CircleDashed className='size-3.5' />
				Never run
			</span>
		);
	}

	const passed = outcome.passedAttempts === outcome.totalAttempts;
	const Icon = passed ? CircleCheck : CircleX;
	const tooltip = outcome.isOutdated
		? 'The test changed after this run'
		: `Run on ${new Date(outcome.runCreatedAt).toLocaleString()}`;

	return (
		<SimpleTooltip content={tooltip}>
			<button
				type='button'
				onClick={() => onOpenRun(outcome.runId)}
				className={cn(
					'inline-flex items-center gap-1 text-xs hover:underline',
					passed ? 'text-green-600 dark:text-green-500' : 'text-destructive',
					outcome.isOutdated && 'opacity-60',
				)}
			>
				<Icon className='size-3.5' />
				{outcomeLabel(outcome, passed)}
				{outcome.isOutdated && <History className='size-3' />}
			</button>
		</SimpleTooltip>
	);
}

function outcomeLabel(outcome: LatestTestOutcome, passed: boolean): string {
	if (outcome.totalAttempts > 1) {
		return `${outcome.passedAttempts}/${outcome.totalAttempts}`;
	}
	return passed ? 'Passed' : 'Failed';
}
