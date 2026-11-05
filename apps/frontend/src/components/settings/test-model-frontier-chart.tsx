import { ChevronRight } from 'lucide-react';

import type { TestModelSummary, TestRunWithResults } from '@/components/settings/test-run-types';
import type { TradeoffPoint, TradeoffSeries } from '@/components/settings/test-tradeoff-chart';
import {
	getAccuracy,
	getSingleRunVariant,
	getTestModelColor,
	groupByBaseModel,
	reasoningEffortRank,
	testModelKey,
} from '@/components/settings/test-run-types';
import { TestTradeoffChart } from '@/components/settings/test-tradeoff-chart';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { createLocalStorage } from '@/lib/local-storage';
import { cn } from '@/lib/utils';

const chartExpandedStorage = createLocalStorage<boolean>('nao-test-accuracy-cost-chart-expanded', true);

interface PlottedSummary {
	summary: TestModelSummary;
	point: TradeoffPoint;
}

/**
 * How accurate each model of a run is for what a question costs, with a line through the reasoning efforts of a model
 * tried at all of them, so that the cheapest effort that stays accurate stands out.
 */
export function ModelFrontierChart({ run }: { run: TestRunWithResults }) {
	const [isExpanded, setIsExpanded] = useLocalStorage(chartExpandedStorage);
	const series = buildFrontierSeries(run);
	const pointCount = series.reduce((count, entry) => count + (entry.line?.length ?? 1), 0);
	if (pointCount < 2) {
		return null;
	}
	return (
		<div className='border-b px-1 py-2'>
			<button
				type='button'
				aria-expanded={isExpanded}
				onClick={() => setIsExpanded(!isExpanded)}
				className='flex cursor-pointer items-center gap-1 rounded px-2 text-xs font-medium hover:text-foreground'
			>
				<ChevronRight
					className={cn('size-3 text-muted-foreground transition-transform', isExpanded && 'rotate-90')}
				/>
				Accuracy vs. cost
			</button>
			{isExpanded && (
				<TestTradeoffChart
					series={series}
					xLabel='Cost per question'
					formatX={formatCostTick}
					ariaLabel='Accuracy against cost per question of each model, at each reasoning effort it ran at'
				/>
			)}
		</div>
	);
}

/** One series per model, labeled at its most accurate effort, the cheapest one among equals. */
function buildFrontierSeries(run: TestRunWithResults): TradeoffSeries[] {
	const variant = getSingleRunVariant(run);
	const summaries = run.modelSummaries.filter((summary) => summary.contextVariant === variant);
	return groupByBaseModel(summaries).flatMap((modelSummaries) => {
		const plotted = plotSummaries(modelSummaries);
		const [best] = [...plotted].sort((left, right) => right.point.y - left.point.y || left.point.x - right.point.x);
		if (!best) {
			return [];
		}
		return [
			{
				key: testModelKey({ provider: best.summary.provider, modelId: best.summary.modelId }),
				label: best.summary.modelId,
				color: getTestModelColor(run.models, best.summary),
				before: null,
				after: best.point,
				line: plotted.length > 1 ? plotted.map((entry) => entry.point) : undefined,
				change: null,
			},
		];
	});
}

/** The summaries that have both a cost and an accuracy, from the lowest reasoning effort to the highest. */
function plotSummaries(summaries: TestModelSummary[]): PlottedSummary[] {
	return summaries
		.flatMap((summary) => {
			const y = getAccuracy(summary);
			const x = summary.costPerQuestion;
			if (x === null || y === null) {
				return [];
			}
			const label = summary.reasoningEffort ? `${summary.reasoningEffort} effort` : undefined;
			return [{ summary, point: { x, y, label } }];
		})
		.sort((left, right) => reasoningEffortRank(left.summary) - reasoningEffortRank(right.summary));
}

/** Ticks keep the digits they need, as a fixed number of decimals reads unevenly across an axis from $0. */
function formatCostTick(cost: number): string {
	return cost === 0 ? '$0' : `$${Number(cost.toPrecision(2))}`;
}
