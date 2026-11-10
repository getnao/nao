import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface HorizontalBarItem {
	key: string;
	label: ReactNode;
	value: number;
	valueLabel: string;
	tooltip?: string;
}

interface HorizontalBarListProps {
	items: HorizontalBarItem[];
	labelClassName?: string;
}

/** Single-series bars, each scaled against the largest value in the list. */
export function HorizontalBarList({ items, labelClassName }: HorizontalBarListProps) {
	const maxValue = Math.max(0, ...items.map((item) => item.value));

	return (
		<ul className='flex flex-col gap-1.5'>
			{items.map((item) => (
				<li
					key={item.key}
					title={item.tooltip}
					className='grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3 text-xs'
				>
					<span className={cn('truncate text-foreground', labelClassName)}>{item.label}</span>
					<span className='h-2 overflow-hidden rounded-sm bg-muted' aria-hidden='true'>
						<span
							className='block h-full rounded-sm bg-chart-1'
							style={{ width: `${maxValue > 0 ? (item.value / maxValue) * 100 : 0}%` }}
						/>
					</span>
					<span className='text-right tabular-nums text-muted-foreground'>{item.valueLabel}</span>
				</li>
			))}
		</ul>
	);
}
