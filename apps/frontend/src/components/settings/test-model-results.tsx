import { useState } from 'react';
import type { LlmSelectedModel } from '@nao/shared/types';
import type { ReactNode } from 'react';

import type {
	TestModelColor,
	TestModelSummary,
	TestRunResult,
	TestRunWithResults,
} from '@/components/settings/test-run-types';
import type { TradeoffSeries } from '@/components/settings/test-tradeoff-chart';
import {
	average,
	formatCount,
	formatDuration,
	formatPassRate,
	formatUnitCost,
	getAccuracy,
	getSingleRunVariant,
	getTestModelColor,
	groupResultsByTest,
	isSameTestModel,
	resultModel,
	testModelKey,
} from '@/components/settings/test-run-types';
import { TestTradeoffChart } from '@/components/settings/test-tradeoff-chart';
import { cn } from '@/lib/utils';

/** Below this many attempts per model, a gap of one test between two models says little. */
const SMALL_SAMPLE_ATTEMPTS = 10;

type ChartMetric = 'cost' | 'tokens' | 'toolCalls' | 'time';

const CHART_METRICS: {
	id: ChartMetric;
	label: string;
	axisLabel: string;
	value: (summary: TestModelSummary) => number | null;
	format: (value: number) => string;
}[] = [
	{
		id: 'cost',
		label: 'Cost',
		axisLabel: 'Cost per question',
		value: (summary) => summary.costPerQuestion,
		format: formatUnitCost,
	},
	{
		id: 'tokens',
		label: 'Tokens',
		axisLabel: 'Tokens per question',
		value: (summary) => summary.averageTokens,
		format: formatCount,
	},
	{
		id: 'toolCalls',
		label: 'Tool calls',
		axisLabel: 'Tool calls per question',
		value: (summary) => summary.averageToolCalls,
		format: formatCount,
	},
	{
		id: 'time',
		label: 'Time',
		axisLabel: 'Time per question',
		value: (summary) => summary.medianDurationMs,
		format: formatDuration,
	},
];

interface LeaderboardColumn {
	label: string;
	title: string;
	value: (summary: TestModelSummary) => number | null;
	format: (value: number | null, summary: TestModelSummary) => ReactNode;
	/** Which end of the column is best, so that it is highlighted. */
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

/** Each test of a run against each model, one dot per attempt. */
export function TestModelMatrix({
	run,
	testPaths,
	onOpenTest,
}: {
	run: TestRunWithResults;
	testPaths: string[];
	onOpenTest: (testPath: string) => void;
}) {
	const resultsByTest = groupResultsByTest(
		run.results.filter((result) => result.contextVariant === getSingleRunVariant(run)),
	);
	return (
		<table className='w-full text-xs'>
			<thead>
				<tr className='border-b text-left text-[11px] text-muted-foreground'>
					<th className='w-2/5 px-3 py-1.5 font-medium'>Test</th>
					{run.models.map((model) => (
						<th key={testModelKey(model)} className='px-3 py-1.5 font-medium'>
							<ModelName models={run.models} model={model} />
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{testPaths.map((testPath) => {
					const results = resultsByTest.get(testPath) ?? [];
					const outcomes = run.models.map((model) =>
						results.filter((result) => isSameTestModel(resultModel(result), model)),
					);
					return (
						<tr
							key={testPath}
							className={cn('border-b last:border-b-0', modelsDisagree(outcomes) && 'bg-amber-500/5')}
						>
							<td className='max-w-0 px-3 py-1.5'>
								<button
									type='button'
									className='w-full cursor-pointer truncate text-left font-medium hover:underline'
									title={`Open tests/${testPath}`}
									onClick={() => onOpenTest(testPath)}
								>
									{results.at(0)?.testName ?? testPath}
								</button>
							</td>
							{outcomes.map((modelResults, index) => (
								<td key={testModelKey(run.models[index])} className='px-3 py-1.5'>
									<AttemptDots results={modelResults} expected={run.attempts} />
								</td>
							))}
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}

/** A single model's run at a glance, with how each metric moved against a baseline when there is one. */
export function RunStatStrip({
	summary,
	baseline,
	baselineLabel,
}: {
	summary: TestModelSummary;
	baseline: TestModelSummary | null;
	baselineLabel: string | null;
}) {
	const stats: {
		label: string;
		value: ReactNode;
		change: ReactNode;
	}[] = [
		{
			label: 'Passed',
			value: `${summary.passedAttempts}/${summary.attempts}`,
			change: baseline?.attempts === summary.attempts && (
				<Change
					value={summary.passedAttempts - baseline.passedAttempts}
					format={(value) => `${Math.abs(value)}`}
					isBetterWhenHigher
				/>
			),
		},
		{
			label: '$ / question',
			value: formatUnitCost(summary.costPerQuestion),
			change: baseline && <RelativeChange value={summary.costPerQuestion} baseline={baseline.costPerQuestion} />,
		},
		{
			label: 'Tool calls / question',
			value: formatCount(summary.averageToolCalls),
			change: baseline && (
				<Change
					value={difference(summary.averageToolCalls, baseline.averageToolCalls)}
					format={(value) => Math.abs(value).toFixed(1)}
				/>
			),
		},
		{
			label: 'Time / question',
			value: formatDuration(summary.medianDurationMs),
			change: baseline && (
				<RelativeChange value={summary.medianDurationMs} baseline={baseline.medianDurationMs} />
			),
		},
		{ label: 'Total cost', value: formatUnitCost(summary.totalCost), change: null },
	];
	return (
		<div className='border-b'>
			<dl className='grid grid-cols-5 divide-x'>
				{stats.map((stat) => (
					<div key={stat.label} className='px-3 py-2'>
						<dt className='text-[11px] text-muted-foreground'>{stat.label}</dt>
						<dd className='flex items-baseline gap-1.5 text-base font-semibold tabular-nums'>
							{stat.value}
							{stat.change}
						</dd>
					</div>
				))}
			</dl>
			{baselineLabel && <p className='px-3 pb-1.5 text-[11px] text-muted-foreground'>{baselineLabel}</p>}
		</div>
	);
}

/**
 * How the user's changes moved each model of a comparison run: the chart of accuracy against a cost-like metric,
 * and the same numbers in a table.
 */
export function ModelChangesChart({ run }: { run: TestRunWithResults }) {
	const [metricId, setMetricId] = useState<ChartMetric>('cost');
	const metric = CHART_METRICS.find((candidate) => candidate.id === metricId) ?? CHART_METRICS[0];
	const pairs = pairVariantSummaries(run);
	const series = pairs.flatMap(({ model, production, draft }): TradeoffSeries[] => {
		const before = production && toPoint(production, metric.value);
		const after = draft && toPoint(draft, metric.value);
		if (!after) {
			return [];
		}
		return [
			{
				key: testModelKey(model),
				label: model.modelId,
				color: getTestModelColor(run.models, model),
				before,
				after,
				change: before ? describeShift(before.y, after.y) : null,
				details: [
					`Production: ${formatAccuracy(production)} · ${production ? formatMetric(metric, production) : '—'}`,
					`Your changes: ${formatAccuracy(draft)} · ${formatMetric(metric, draft)}`,
					`${draft.attempts} attempts per side`,
				],
			},
		];
	});

	return (
		<div className='flex border-b'>
			<div className='min-w-0 flex-[3] border-r px-1 pt-2'>
				<div className='flex items-center justify-between px-2 pb-1'>
					<span className='text-xs font-medium'>Accuracy vs. {metric.label.toLowerCase()}</span>
					<MetricToggle metric={metricId} onChange={setMetricId} />
				</div>
				{series.length > 0 ? (
					<TestTradeoffChart
						series={series}
						xLabel={metric.axisLabel}
						formatX={metric.format}
						ariaLabel={`Accuracy against ${metric.axisLabel.toLowerCase()} of each model, on production and with your changes`}
					/>
				) : (
					<p className='px-2 py-8 text-center text-xs text-muted-foreground'>
						The chart shows once a model has {metric.label.toLowerCase()} for both sides.
					</p>
				)}
				<ChartLegend run={run} />
			</div>
			<div className='min-w-0 flex-[2]'>
				<table className='w-full text-xs'>
					<thead>
						<tr className='border-b text-left text-[11px] text-muted-foreground'>
							<th className='px-3 py-1.5 font-medium'>Model</th>
							<th className='px-3 py-1.5 text-right font-medium'>Accuracy</th>
							<th className='px-3 py-1.5 text-right font-medium'>{metric.label}</th>
						</tr>
					</thead>
					<tbody>
						{pairs.map(({ model, production, draft }) => (
							<tr key={testModelKey(model)} className='border-b last:border-b-0'>
								<td className='px-3 py-1.5'>
									<ModelName models={run.models} model={model} />
								</td>
								<td className='px-3 py-1.5 text-right whitespace-nowrap tabular-nums'>
									{formatAccuracy(production)} → {formatAccuracy(draft)}
								</td>
								<td className='px-3 py-1.5 text-right whitespace-nowrap tabular-nums'>
									{production ? formatMetric(metric, production) : '—'} →{' '}
									{draft ? formatMetric(metric, draft) : '—'}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

/** Cost, tool calls and time of each test of a run, to spot the ones that cost the most. */
export function summarizeTestMetrics(results: TestRunResult[]) {
	const metrics = new Map<
		string,
		{ costPerQuestion: number | null; toolCalls: number | null; durationMs: number | null }
	>();
	for (const [testPath, testResults] of groupResultsByTest(results)) {
		metrics.set(testPath, {
			costPerQuestion: average(testResults.map((result) => result.totalCost)),
			toolCalls: average(testResults.map((result) => result.toolCallCount)),
			durationMs: average(testResults.map((result) => result.durationMs)),
		});
	}
	return metrics;
}

/** Tests whose models do not agree, for the "Models disagree" filter. */
export function listTestsWhereModelsDisagree(run: TestRunWithResults): Set<string> {
	const disagreeing = new Set<string>();
	for (const [testPath, results] of groupResultsByTest(
		run.results.filter((result) => result.contextVariant === getSingleRunVariant(run)),
	)) {
		const outcomes = run.models.map((model) =>
			results.filter((result) => isSameTestModel(resultModel(result), model)),
		);
		if (modelsDisagree(outcomes)) {
			disagreeing.add(testPath);
		}
	}
	return disagreeing;
}

export function ModelName({
	models,
	model,
	isBold = false,
}: {
	models: LlmSelectedModel[];
	model: LlmSelectedModel;
	isBold?: boolean;
}) {
	return (
		<span className='flex min-w-0 items-center gap-1.5'>
			<ModelDot color={getTestModelColor(models, model)} />
			<span className={cn('truncate', isBold && 'font-medium')}>{model.modelId}</span>
		</span>
	);
}

export function ModelDot({ color }: { color: TestModelColor }) {
	return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', color.background)} />;
}

export function AttemptDots({
	results,
	expected,
}: {
	results: Pick<TestRunResult, 'id' | 'passed'>[];
	expected: number;
}) {
	const passed = results.filter((result) => result.passed).length;
	return (
		<span className='flex items-center gap-1' aria-label={`${passed} of ${results.length} attempts passed`}>
			<span className='flex gap-0.5'>
				{results.map((result) => (
					<span
						key={result.id}
						className={cn(
							'size-2 rounded-full',
							result.passed ? 'bg-green-600 dark:bg-green-500' : 'bg-destructive',
						)}
					/>
				))}
				{Array.from({ length: Math.max(0, expected - results.length) }, (_, index) => (
					<span key={`pending-${index}`} className='size-2 rounded-full border border-muted-foreground/50' />
				))}
			</span>
			{results.length > 0 && passed < results.length && (
				<span className={cn('tabular-nums', passed === 0 ? 'text-destructive' : 'text-muted-foreground')}>
					{passed}/{results.length}
				</span>
			)}
		</span>
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

function MetricToggle({ metric, onChange }: { metric: ChartMetric; onChange: (metric: ChartMetric) => void }) {
	return (
		<div role='radiogroup' aria-label='Compare accuracy with' className='flex rounded-md border p-0.5 text-[11px]'>
			{CHART_METRICS.map((option) => (
				<button
					key={option.id}
					type='button'
					role='radio'
					aria-checked={metric === option.id}
					onClick={() => onChange(option.id)}
					className={cn(
						'cursor-pointer rounded px-2 py-0.5 transition-colors',
						metric === option.id
							? 'bg-accent font-medium text-foreground'
							: 'text-muted-foreground hover:text-foreground',
					)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

function ChartLegend({ run }: { run: TestRunWithResults }) {
	return (
		<div className='flex flex-wrap items-center gap-x-3 gap-y-1 px-2 pb-2 text-[11px] text-muted-foreground'>
			<span className='flex items-center gap-1'>
				<span className='size-2 rounded-full border-2 border-muted-foreground' /> Production
			</span>
			<span className='flex items-center gap-1'>
				<span className='size-2 rounded-full bg-muted-foreground' /> Your changes
			</span>
			{run.models.map((model) => (
				<span key={testModelKey(model)} className='flex items-center gap-1'>
					<ModelDot color={getTestModelColor(run.models, model)} />
					{model.modelId}
				</span>
			))}
		</div>
	);
}

function Change({
	value,
	format,
	isBetterWhenHigher = false,
}: {
	value: number | null;
	format: (value: number) => string;
	isBetterWhenHigher?: boolean;
}) {
	if (value === null) {
		return null;
	}
	if (value === 0) {
		return <span className='text-[11px] font-medium text-muted-foreground'>=</span>;
	}
	const isBetter = value > 0 === isBetterWhenHigher;
	return (
		<span
			className={cn(
				'text-[11px] font-medium',
				isBetter ? 'text-green-700 dark:text-green-400' : 'text-destructive',
			)}
		>
			{value > 0 ? '▲' : '▼'} {format(value)}
		</span>
	);
}

function RelativeChange({ value, baseline }: { value: number | null; baseline: number | null }) {
	if (value === null || baseline === null || baseline === 0) {
		return null;
	}
	const ratio = value / baseline - 1;
	return (
		<Change
			value={Math.abs(ratio) < 0.005 ? 0 : ratio}
			format={(change) => `${Math.round(Math.abs(change) * 100)}%`}
		/>
	);
}

function pairVariantSummaries(run: TestRunWithResults) {
	return run.models.map((model) => ({
		model,
		production:
			run.modelSummaries.find(
				(summary) => summary.contextVariant === 'production' && isSameTestModel(summary, model),
			) ?? null,
		draft:
			run.modelSummaries.find(
				(summary) => summary.contextVariant === 'draft' && isSameTestModel(summary, model),
			) ?? null,
	}));
}

function toPoint(summary: TestModelSummary, value: (summary: TestModelSummary) => number | null) {
	const x = value(summary);
	const y = getAccuracy(summary);
	return x === null || y === null ? null : { x, y };
}

function describeShift(before: number, after: number): string {
	const points = Math.round((after - before) * 100);
	return points === 0 ? '±0 pts' : `${points > 0 ? '+' : '−'}${Math.abs(points)} pts`;
}

function formatAccuracy(summary: TestModelSummary | null): string {
	return summary ? formatPassRate(summary.passedAttempts, summary.attempts) : '—';
}

function formatMetric(metric: (typeof CHART_METRICS)[number], summary: TestModelSummary): string {
	const value = metric.value(summary);
	return value === null ? '—' : metric.format(value);
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

function modelsDisagree(outcomes: Pick<TestRunResult, 'passed'>[][]): boolean {
	const passRates = outcomes
		.filter((results) => results.length > 0)
		.map((results) => results.filter((result) => result.passed).length / results.length);
	return new Set(passRates).size > 1;
}

function difference(value: number | null, baseline: number | null): number | null {
	return value === null || baseline === null ? null : Math.round((value - baseline) * 10) / 10;
}
