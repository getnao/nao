import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { calculateVisibleGroupChipCount } from '@/lib/user-group-chip-overflow';
import { cn } from '@/lib/utils';

type GroupChipSize = 'default' | 'compact';

export function ResponsiveGroupChips({
	names,
	size = 'default',
	className,
}: {
	names: string[];
	size?: GroupChipSize;
	className?: string;
}) {
	const labelAreaRef = useRef<HTMLSpanElement>(null);
	const measurementRef = useRef<HTMLSpanElement>(null);
	const [visibleCount, setVisibleCount] = useState(0);

	const measure = useCallback(() => {
		const labelArea = labelAreaRef.current;
		const measurement = measurementRef.current;
		if (!labelArea || !measurement) {
			return;
		}

		const groupChipWidths = Array.from(
			measurement.querySelectorAll<HTMLElement>('[data-measure-group]'),
			(element) => element.getBoundingClientRect().width,
		);
		const overflowChipWidths = Array<number>(names.length + 1);
		for (const element of measurement.querySelectorAll<HTMLElement>('[data-measure-overflow]')) {
			overflowChipWidths[Number(element.dataset.measureOverflow)] = element.getBoundingClientRect().width;
		}
		const gap = Number.parseFloat(getComputedStyle(measurement).columnGap) || 0;
		setVisibleCount(
			calculateVisibleGroupChipCount({
				availableWidth: labelArea.getBoundingClientRect().width,
				groupChipWidths,
				overflowChipWidths,
				gap,
			}),
		);
	}, [names]);

	useLayoutEffect(() => {
		measure();
		const labelArea = labelAreaRef.current;
		const measurement = measurementRef.current;
		if (!labelArea || !measurement) {
			return;
		}

		const observer = new ResizeObserver(measure);
		observer.observe(labelArea);
		observer.observe(measurement);
		return () => observer.disconnect();
	}, [measure]);

	const safeVisibleCount = Math.min(visibleCount, names.length);
	const hiddenCount = names.length - safeVisibleCount;

	return (
		<span
			ref={labelAreaRef}
			className={cn(
				'relative flex min-w-0 flex-1 items-center overflow-hidden',
				size === 'compact' ? 'gap-0.5' : 'gap-1',
				className,
			)}
			title={names.join(', ')}
		>
			{names.length === 0 ? (
				<GroupNameChip name='No groups' size={size} />
			) : (
				<>
					{names.slice(0, safeVisibleCount).map((name, index) => (
						<GroupNameChip key={`${name}-${index}`} name={name} size={size} />
					))}
					{hiddenCount > 0 && <GroupNameChip name={`+${hiddenCount}`} size={size} />}
				</>
			)}
			<span
				ref={measurementRef}
				aria-hidden
				className={cn(
					'pointer-events-none invisible absolute left-0 top-0 flex w-max items-center',
					size === 'compact' ? 'gap-0.5' : 'gap-1',
				)}
			>
				{names.map((name, index) => (
					<GroupNameChip key={`measure-${name}-${index}`} name={name} size={size} measure='group' />
				))}
				{names.map((_, index) => {
					const hidden = index + 1;
					return (
						<GroupNameChip
							key={`measure-overflow-${hidden}`}
							name={`+${hidden}`}
							size={size}
							measure={hidden}
						/>
					);
				})}
			</span>
		</span>
	);
}

function GroupNameChip({ name, size, measure }: { name: string; size: GroupChipSize; measure?: 'group' | number }) {
	return (
		<Badge
			variant='secondary'
			className={cn('py-0 font-normal', size === 'compact' ? 'h-4 px-1 text-[9px]' : 'h-5 px-1.5 text-[10px]')}
			data-measure-group={measure === 'group' ? '' : undefined}
			data-measure-overflow={typeof measure === 'number' ? measure : undefined}
		>
			{name}
		</Badge>
	);
}
