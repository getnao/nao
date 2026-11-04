import type { ReactNode } from 'react';

import type { TestModelSummary, TestRunWithResults } from '@/components/settings/test-run-types';
import { ModelName } from '@/components/settings/test-model-labels';
import {
	formatCount,
	formatDuration,
	formatPassRate,
	formatUnitCost,
	getAccuracy,
	testModelKey,
} from '@/components/settings/test-run-types';
import { cn } from '@/lib/utils';

/** Below this many attempts per model, a gap of one test between two models says little. */
const SMALL_SAMPLE_ATTEMPTS = 10;

interface LeaderboardColumn {
	label: string;
	title: string;
	value: (summary: TestModelSummary) => number | null;
	format: (value: number | null, summary: TestModelSummary) => ReactNode;
	best: 'highest' | 'lowest';
}

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

/** The models of a run side by side, most accurate first, with the best value of each metric highlighted. */
export function ModelLeaderboard({ run }: { run: TestRunWithResults }) {
	const summaries = run.modelSummaries;
	const mostAccurate = summaries.at(0);
	const bestValue = pickBest(summaries, (summary) => summary.costPerCorrectAnswer, 'lowest');
	const isSmallSample = summaries.some((summary) => summary.attempts < SMALL_SAMPLE_ATTEMPTS);
	return (
		<div className='border-b'>
			<table className='w-full text-xs'>
				<thead>
					<tr className='border-b text-left text-[11px] text-muted-foreground'>
						<th className='px-3 py-1.5 font-medium'>Model</th>
						<th className='px-3 py-1.5 font-medium'>Accuracy</th>
						{LEADERBOARD_COLUMNS.map((column) => (
							<th key={column.label} className='px-3 py-1.5 text-right font-medium' title={column.title}>
								{column.label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{summaries.map((summary) => (
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
			{isSmallSample && (
				<p className='px-3 pb-2 text-[11px] text-muted-foreground'>
					Few attempts per model: a gap of one test between two models may be chance. Add attempts to tell
					them apart.
				</p>
			)}
		</div>
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
