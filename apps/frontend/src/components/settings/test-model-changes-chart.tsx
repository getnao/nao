import { isSameModel } from '@nao/shared/types';
import { useState } from 'react';

import type { TestModelSummary, TestRunWithResults } from '@/components/settings/test-run-types';
import type { TradeoffSeries } from '@/components/settings/test-tradeoff-chart';
import { ModelDot, ModelName } from '@/components/settings/test-model-labels';
import { BranchName } from '@/components/settings/test-run-labels';
import {
	formatCount,
	formatDuration,
	formatPassRate,
	formatUnitCost,
	getAccuracy,
	getTestModelColor,
	testModelKey,
} from '@/components/settings/test-run-types';
import { TestTradeoffChart } from '@/components/settings/test-tradeoff-chart';
import { cn } from '@/lib/utils';

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

export function ModelChangesChart({ run, mainBranch }: { run: TestRunWithResults; mainBranch: string }) {
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
					`${mainBranch}: ${formatAccuracy(production)} · ${production ? formatMetric(metric, production) : '—'}`,
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
						ariaLabel={`Accuracy against ${metric.axisLabel.toLowerCase()} of each model, on ${mainBranch} and with your changes`}
					/>
				) : (
					<p className='px-2 py-8 text-center text-xs text-muted-foreground'>
						The chart shows once a model has {metric.label.toLowerCase()} for both sides.
					</p>
				)}
				<ChartLegend run={run} mainBranch={mainBranch} />
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

function ChartLegend({ run, mainBranch }: { run: TestRunWithResults; mainBranch: string }) {
	return (
		<div className='flex flex-wrap items-center gap-x-3 gap-y-1 px-2 pb-2 text-[11px] text-muted-foreground'>
			<span className='flex items-center gap-1'>
				<span className='size-2 rounded-full border-2 border-muted-foreground' />
				<BranchName name={mainBranch} />
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

function pairVariantSummaries(run: TestRunWithResults) {
	return run.models.map((model) => ({
		model,
		production:
			run.modelSummaries.find(
				(summary) => summary.contextVariant === 'production' && isSameModel(summary, model),
			) ?? null,
		draft:
			run.modelSummaries.find((summary) => summary.contextVariant === 'draft' && isSameModel(summary, model)) ??
			null,
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
