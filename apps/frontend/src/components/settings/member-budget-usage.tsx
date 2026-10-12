/* @license Enterprise */

import { getMemberBudgetStatus } from '@nao/shared/member-budget';
import type { MemberBudgetPeriod } from '@nao/shared/types';

import { Badge } from '@/components/ui/badge';
import { formatUsd, PERIOD_LABELS, STATUS_META } from '@/lib/member-budget';
import { cn, toUtcDateString } from '@/lib/utils';

const PROGRESS_CLASS_NAMES = {
	exceeded: 'bg-destructive',
	close: 'bg-amber-500',
	under: 'bg-green-500',
	unlimited: 'bg-muted-foreground',
};

interface MemberBudgetUsageProps {
	spendUsd: number;
	limitUsd: number;
	period: MemberBudgetPeriod;
	nextPeriodStart: Date | string;
	sourceLabel: string;
}

/** Spend against the limit as a gauge; the gauge stays empty when no limit applies. */
export function MemberBudgetUsage({
	spendUsd,
	limitUsd,
	period,
	nextPeriodStart,
	sourceLabel,
}: MemberBudgetUsageProps) {
	const status = getMemberBudgetStatus(spendUsd, limitUsd);
	const periodLabel = PERIOD_LABELS[period].toLowerCase();
	const usedPercent = status === 'unlimited' ? 0 : Math.min(100, Math.round((spendUsd / limitUsd) * 100));

	return (
		<div className='flex flex-col gap-3'>
			<div className='flex items-center justify-between gap-2'>
				<span className='text-sm tabular-nums'>
					<span className='text-lg font-semibold'>{formatUsd(spendUsd, 2)}</span>
					<span className='text-muted-foreground'>
						{status === 'unlimited'
							? ` spent this ${periodLabel}`
							: ` of ${formatUsd(limitUsd)} / ${periodLabel}`}
					</span>
				</span>
				<Badge variant='ghost' className={cn('text-[11px]', STATUS_META[status].className)}>
					{STATUS_META[status].label}
				</Badge>
			</div>
			<div className='h-2 w-full overflow-hidden rounded-full bg-muted'>
				<div
					className={cn('h-full rounded-full transition-all', PROGRESS_CLASS_NAMES[status])}
					style={{ width: `${usedPercent}%` }}
				/>
			</div>
			<div className='flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground'>
				<span>{sourceLabel}</span>
				<span>Resets on {toUtcDateString(new Date(nextPeriodStart))}</span>
			</div>
		</div>
	);
}
