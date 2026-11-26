import type { ReactNode } from 'react';

import type { TestModelSummary } from '@/components/settings/test-run-types';
import { formatCount, formatDuration, formatUnitCost } from '@/components/settings/test-run-types';
import { cn } from '@/lib/utils';

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

function difference(value: number | null, baseline: number | null): number | null {
	return value === null || baseline === null ? null : Math.round((value - baseline) * 10) / 10;
}
