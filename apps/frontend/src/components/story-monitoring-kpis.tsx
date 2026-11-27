import { ArrowDownRight, ArrowUpRight, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

const DAILY_COST = [0.62, 0.71, 0.58, 0.66, 0.74, 0.69, 0.63, 0.71, 0.66, 0.68, 1.92, 2.41, 3.08, 4.12];
const DAILY_MEDIAN_SECONDS = [17, 18, 17, 19, 18, 17, 18, 18, 17, 18, 19, 20, 18, 18];
const DAILY_RUNS = [24, 24, 23, 24, 24, 24, 24, 24, 22, 24, 61, 96, 96, 41];
const DAILY_FAILED = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 1];
const LIMIT = 2;

/** Each tile carries its own 14-day trend, so a jump in cost or refreshes shows without a chart. */
export function StoryMonitoringKpis() {
	return (
		<div className='grid grid-cols-3 gap-2'>
			<SparkTile
				label='LLM cost · 14d'
				value='$18.81'
				detail='4.2M tokens'
				delta='+212%'
				deltaBad
				footer={
					<button type='button' className='flex items-center gap-1 hover:text-foreground'>
						<span className='w-3 border-t border-dashed border-destructive/60' />
						alert at $2/day
						<Pencil className='size-2.5' />
					</button>
				}
			>
				<Bars values={DAILY_COST} threshold={LIMIT} />
			</SparkTile>
			<SparkTile label='Median duration' value='18s' detail='mean 21s' delta='+1s'>
				<Line values={DAILY_MEDIAN_SECONDS} />
			</SparkTile>
			<SparkTile label='Refreshes · 14d' value='587' detail='4 failed' delta='+190%'>
				<Bars values={DAILY_RUNS} failed={DAILY_FAILED} />
			</SparkTile>
		</div>
	);
}

export function SparkTile({
	label,
	value,
	detail,
	delta,
	deltaBad,
	footer,
	children,
}: {
	label: string;
	value: string;
	detail: string;
	delta: string;
	deltaBad?: boolean;
	footer?: ReactNode;
	children: ReactNode;
}) {
	const DeltaIcon = delta.startsWith('-') ? ArrowDownRight : ArrowUpRight;
	return (
		<div className='flex min-w-0 flex-col gap-2 rounded-xl border p-3'>
			<div className='flex items-center justify-between gap-2 text-xs text-muted-foreground'>
				<span className='truncate'>{label}</span>
				<span className={cn('flex items-center gap-0.5 tabular-nums', deltaBad && 'text-destructive')}>
					<DeltaIcon className='size-3' />
					{delta}
				</span>
			</div>
			<div className='flex items-baseline gap-2'>
				<span className='text-xl font-semibold tabular-nums'>{value}</span>
				<span className='truncate text-xs text-muted-foreground'>{detail}</span>
			</div>
			<div className='h-8'>{children}</div>
			{footer && <div className='text-[11px] text-muted-foreground'>{footer}</div>}
		</div>
	);
}

export function Bars({ values, failed, threshold }: { values: number[]; failed?: number[]; threshold?: number }) {
	const max = Math.max(...values, threshold ?? 0);
	return (
		<div className='relative flex h-full items-end gap-[2px]'>
			{threshold !== undefined && (
				<span
					className='absolute inset-x-0 border-t border-dashed border-destructive/60'
					style={{ bottom: `${(threshold / max) * 100}%` }}
				/>
			)}
			{values.map((value, index) => {
				const isOver = threshold !== undefined && value > threshold;
				const failedShare = failed ? failed[index] / value : 0;
				return (
					<span key={index} className='flex h-full flex-1 flex-col justify-end'>
						{failedShare > 0 && (
							<span
								className='w-full rounded-t-[1px] bg-destructive'
								style={{ height: `${Math.max(12, failedShare * 100)}%` }}
							/>
						)}
						<span
							className={cn('w-full rounded-[1px]', isOver ? 'bg-destructive/80' : 'bg-chart-1')}
							style={{ height: `${(value / max) * 100}%` }}
						/>
					</span>
				);
			})}
		</div>
	);
}

export function Line({ values }: { values: number[] }) {
	const max = Math.max(...values) + 2;
	const min = Math.min(...values) - 2;
	const points = values
		.map((value, index) => `${(index / (values.length - 1)) * 100},${100 - ((value - min) / (max - min)) * 100}`)
		.join(' ');
	return (
		<svg viewBox='0 0 100 100' preserveAspectRatio='none' className='size-full overflow-visible'>
			<polyline
				points={points}
				fill='none'
				stroke='var(--chart-1)'
				strokeWidth='2'
				vectorEffect='non-scaling-stroke'
			/>
		</svg>
	);
}
