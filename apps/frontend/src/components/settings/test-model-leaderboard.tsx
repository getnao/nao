import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import type { TestModelSummary, TestRunWithResults } from '@/components/settings/test-run-types';
import { ModelFrontierChart } from '@/components/settings/test-model-frontier-chart';
import { ModelName } from '@/components/settings/test-model-labels';
import {
	formatCount,
	formatDuration,
	formatPassRate,
	formatTestModel,
	formatUnitCost,
	getAccuracy,
	testModelKey,
} from '@/components/settings/test-run-types';
import { cn } from '@/lib/utils';

type SortDirection = 'ascending' | 'descending';

interface LeaderboardSort {
	column: string;
	direction: SortDirection;
}

/** A column the table sorts by, from its best value first on the first click. */
interface SortableColumn {
	label: string;
	title?: string;
	value: (summary: TestModelSummary) => number | string | null;
	best: 'highest' | 'lowest';
}

interface LeaderboardColumn extends SortableColumn {
	title: string;
	value: (summary: TestModelSummary) => number | null;
	format: (value: number | null, summary: TestModelSummary) => ReactNode;
}

const MODEL_COLUMN: SortableColumn = { label: 'Model', value: formatTestModel, best: 'lowest' };

const ACCURACY_COLUMN: SortableColumn = {
	label: 'Accuracy',
	title: 'Share of the attempts that passed',
	value: getAccuracy,
	best: 'highest',
};

const LEADERBOARD_COLUMNS: LeaderboardColumn[] = [
	{
		label: 'Reliable',
		title: 'Tests where every attempt passed',
		value: (summary) => summary.reliableTestCount / Math.max(summary.testCount, 1),
		format: (_, summary) => `${summary.reliableTestCount}/${summary.testCount}`,
		best: 'highest',
	},
	{
		label: '$ / question',
		title: 'Average cost of one question',
		value: (summary) => summary.costPerQuestion,
		format: formatUnitCost,
		best: 'lowest',
	},
	{
		label: '$ / correct',
		title: 'Total cost divided by the attempts that passed: cheap but wrong models rank low',
		value: (summary) => summary.costPerCorrectAnswer,
		format: formatUnitCost,
		best: 'lowest',
	},
	{
		label: 'Tool calls',
		title: 'Average tool calls per question',
		value: (summary) => summary.averageToolCalls,
		format: formatCount,
		best: 'lowest',
	},
	{
		label: 'Time',
		title: 'Median time to answer a question',
		value: (summary) => summary.medianDurationMs,
		format: formatDuration,
		best: 'lowest',
	},
	{
		label: 'Tokens',
		title: 'Average tokens per question',
		value: (summary) => summary.averageTokens,
		format: formatCount,
		best: 'lowest',
	},
];

/**
 * The models of a run side by side, most accurate first unless sorted by a column, with the best value of each metric
 * highlighted, under the chart of their accuracy against their cost.
 */
export function ModelLeaderboard({ run }: { run: TestRunWithResults }) {
	const [sort, setSort] = useState<LeaderboardSort | null>(null);
	const summaries = run.modelSummaries;
	const mostAccurate = summaries.at(0);
	const bestValue = pickBest(summaries, (summary) => summary.costPerCorrectAnswer, 'lowest');
	const sortedSummaries = sortSummaries(summaries, sort);
	const toggleSort = (column: SortableColumn) => setSort((current) => nextSort(current, column));
	return (
		<div className='border-b'>
			<ModelFrontierChart run={run} />
			<table className='w-full text-xs'>
				<thead>
					<tr className='text-left text-[11px] text-muted-foreground'>
						<SortableHeader column={MODEL_COLUMN} sort={sort} onSort={toggleSort} />
						<SortableHeader column={ACCURACY_COLUMN} sort={sort} onSort={toggleSort} />
						{LEADERBOARD_COLUMNS.map((column) => (
							<SortableHeader
								key={column.label}
								column={column}
								sort={sort}
								onSort={toggleSort}
								isNumeric
							/>
						))}
					</tr>
				</thead>
				<tbody>
					{sortedSummaries.map((summary) => (
						<tr key={testModelKey(summary)} className='border-b last:border-b-0'>
							<td className='px-3 py-1.5'>
								<span className='flex items-center gap-2'>
									<ModelName models={run.models} model={summary} isBold />
									{summary === mostAccurate && summaries.length > 1 && (
										<span className='rounded-full bg-green-600/10 px-1.5 text-[10.5px] font-medium text-green-700 dark:text-green-400'>
											Most accurate
										</span>
									)}
									{summary === bestValue && summary !== mostAccurate && (
										<span className='rounded-full bg-primary/10 px-1.5 text-[10.5px] font-medium text-primary'>
											Best value
										</span>
									)}
								</span>
							</td>
							<td className='px-3 py-1.5'>
								<AccuracyCell
									summary={summary}
									isBest={summary === mostAccurate && summaries.length > 1}
								/>
							</td>
							{LEADERBOARD_COLUMNS.map((column) => (
								<td
									key={column.label}
									className={cn(
										'px-3 py-1.5 text-right tabular-nums',
										summaries.length > 1 &&
											summary === pickBest(summaries, column.value, column.best) &&
											'font-semibold text-green-700 dark:text-green-400',
									)}
								>
									{column.format(column.value(summary), summary)}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** Sticks under the header of the run while the table scrolls, the bottom border drawn as a shadow to stick along. */
function SortableHeader({
	column,
	sort,
	onSort,
	isNumeric = false,
}: {
	column: SortableColumn;
	sort: LeaderboardSort | null;
	onSort: (column: SortableColumn) => void;
	isNumeric?: boolean;
}) {
	const direction = sort?.column === column.label ? sort.direction : null;
	const DirectionIcon = direction === 'ascending' ? ArrowUp : ArrowDown;
	return (
		<th
			className={cn(
				'sticky top-9 z-[5] bg-background px-3 py-1.5 font-medium shadow-[inset_0_-1px_0_var(--border)]',
				isNumeric && 'text-right',
			)}
			title={column.title}
			aria-sort={direction ?? undefined}
		>
			<button
				type='button'
				onClick={() => onSort(column)}
				className={cn(
					'group inline-flex cursor-pointer items-center gap-1 hover:text-foreground',
					isNumeric && 'flex-row-reverse',
					direction && 'text-foreground',
				)}
			>
				{column.label}
				<DirectionIcon
					className={cn('size-3 shrink-0', direction ? 'opacity-100' : 'opacity-0 group-hover:opacity-50')}
				/>
			</button>
		</th>
	);
}

function AccuracyCell({ summary, isBest }: { summary: TestModelSummary; isBest: boolean }) {
	const accuracy = getAccuracy(summary) ?? 0;
	return (
		<span
			className={cn(
				'flex items-center gap-2 tabular-nums',
				isBest && 'font-semibold text-green-700 dark:text-green-400',
			)}
		>
			<span className='h-1 w-12 overflow-hidden rounded-full bg-muted'>
				<span className='block h-full bg-foreground/50' style={{ width: `${accuracy * 100}%` }} />
			</span>
			{formatPassRate(summary.passedAttempts, summary.attempts)}
		</span>
	);
}

function pickBest(
	summaries: TestModelSummary[],
	value: (summary: TestModelSummary) => number | null,
	best: 'highest' | 'lowest',
): TestModelSummary | undefined {
	const ranked = summaries
		.map((summary) => ({ summary, value: value(summary) }))
		.filter((entry): entry is { summary: TestModelSummary; value: number } => entry.value !== null)
		.sort((left, right) => (best === 'highest' ? right.value - left.value : left.value - right.value));
	return ranked.at(0)?.summary;
}

/** Sorts by a column from its best value, then the other way, then back to the order of the run. */
function nextSort(current: LeaderboardSort | null, column: SortableColumn): LeaderboardSort | null {
	const firstDirection: SortDirection = column.best === 'highest' ? 'descending' : 'ascending';
	if (current?.column !== column.label) {
		return { column: column.label, direction: firstDirection };
	}
	if (current.direction === firstDirection) {
		return { column: column.label, direction: firstDirection === 'ascending' ? 'descending' : 'ascending' };
	}
	return null;
}

/** Orders the models by the sorted column, the ones without a value last whatever the direction. */
function sortSummaries(summaries: TestModelSummary[], sort: LeaderboardSort | null): TestModelSummary[] {
	const column = [MODEL_COLUMN, ACCURACY_COLUMN, ...LEADERBOARD_COLUMNS].find(
		(candidate) => candidate.label === sort?.column,
	);
	if (!sort || !column) {
		return summaries;
	}
	const sign = sort.direction === 'ascending' ? 1 : -1;
	return [...summaries].sort((left, right) => {
		const leftValue = column.value(left);
		const rightValue = column.value(right);
		if (leftValue === null || rightValue === null) {
			return Number(leftValue === null) - Number(rightValue === null);
		}
		return sign * compareValues(leftValue, rightValue);
	});
}

function compareValues(left: number | string, right: number | string): number {
	if (typeof left === 'number' && typeof right === 'number') {
		return left - right;
	}
	return String(left).localeCompare(String(right), undefined, { numeric: true });
}
