import { useRef, useState } from 'react';

import { useResizeObserver } from './use-resize-observer';

export type NavDensity = 'comfortable' | 'default' | 'compact';

export function useNavDensity(rowCount: number, groupCount: number) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [density, setDensity] = useState<NavDensity>('default');

	useResizeObserver(
		containerRef,
		(element) => {
			setDensity(getNavDensity(element.getBoundingClientRect().height, rowCount, groupCount));
		},
		[rowCount, groupCount],
	);

	return { containerRef, density };
}

export function getNavDensity(availableHeight: number, rowCount: number, groupCount: number): NavDensity {
	return (
		navDensityOrder.find(
			(density) => getRequiredHeight(density, rowCount, groupCount) <= availableHeight + FIT_TOLERANCE_PX,
		) ?? 'compact'
	);
}

export const navDensityClasses = {
	comfortable: {
		itemContainer: 'gap-1',
		groupHeader: 'pt-6',
		row: 'px-3 py-2 text-sm',
	},
	default: {
		itemContainer: 'gap-1',
		groupHeader: 'pt-4',
		row: 'px-3 py-2 text-sm',
	},
	compact: {
		itemContainer: 'gap-0.5',
		groupHeader: 'pt-3',
		row: 'px-3 py-1.5 text-[13px] leading-5',
	},
} as const satisfies Record<NavDensity, { itemContainer: string; groupHeader: string; row: string }>;

const navDensityPixels = {
	comfortable: {
		rowHeight: 36,
		groupHeaderHeight: 40,
		interItemGap: 4,
	},
	default: {
		rowHeight: 36,
		groupHeaderHeight: 32,
		interItemGap: 4,
	},
	compact: {
		rowHeight: 32,
		groupHeaderHeight: 28,
		interItemGap: 2,
	},
} as const satisfies Record<NavDensity, { rowHeight: number; groupHeaderHeight: number; interItemGap: number }>;

const navDensityOrder: NavDensity[] = ['comfortable', 'default', 'compact'];
const FIT_TOLERANCE_PX = 4;

function getRequiredHeight(density: NavDensity, rowCount: number, groupCount: number) {
	const { rowHeight, groupHeaderHeight, interItemGap } = navDensityPixels[density];
	const gapCount = Math.max(rowCount + groupCount - 1, 0);

	return rowCount * rowHeight + groupCount * groupHeaderHeight + gapCount * interItemGap;
}
