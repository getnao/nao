import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { calculateVisibleGroupChipCount } from '@/lib/user-group-chip-overflow';
import { cn } from '@/lib/utils';

export function ResponsiveGroupChips({ names, className }: { names: string[]; className?: string }) {
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
			className={cn('relative flex min-w-0 flex-1 items-center gap-1 overflow-hidden', className)}
			title={names.join(', ')}
		>
			{names.length === 0 ? (
				<GroupNameChip name='No groups' />
			) : (
				<>
					{names.slice(0, safeVisibleCount).map((name, index) => (
						<GroupNameChip key={`${name}-${index}`} name={name} />
					))}
					{hiddenCount > 0 && <GroupNameChip name={`+${hiddenCount}`} />}
				</>
			)}
			<span
				ref={measurementRef}
				aria-hidden
				className='pointer-events-none invisible absolute left-0 top-0 flex w-max items-center gap-1'
			>
				{names.map((name, index) => (
					<GroupNameChip key={`measure-${name}-${index}`} name={name} measure='group' />
				))}
				{names.map((_, index) => {
					const hidden = index + 1;
					return <GroupNameChip key={`measure-overflow-${hidden}`} name={`+${hidden}`} measure={hidden} />;
				})}
			</span>
		</span>
	);
}

function GroupNameChip({ name, measure }: { name: string; measure?: 'group' | number }) {
	return (
		<Badge
			variant='secondary'
			className='h-5 px-1.5 py-0 text-[10px] font-normal'
			data-measure-group={measure === 'group' ? '' : undefined}
			data-measure-overflow={typeof measure === 'number' ? measure : undefined}
		>
			{name}
		</Badge>
	);
}
