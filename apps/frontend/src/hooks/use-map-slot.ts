import { useCallback, useEffect, useState } from 'react';
import type { MapSlotBudget } from '@/lib/map-slot-budget';

import { mapSlotBudget } from '@/lib/map-slot-budget';

const NEAR_VIEWPORT_MARGIN = '100% 0px';

export interface MapSlot {
	isLive: boolean;
	isPaused: boolean;
	pause: () => void;
	resume: () => void;
}

/** Keeps a map live only while its element is near the visible area, and paused after a WebGL context loss until resumed. */
export function useMapSlot(element: HTMLElement | null, budget: MapSlotBudget = mapSlotBudget): MapSlot {
	const isNearViewport = useIsNearViewport(element);
	const [isPaused, setIsPaused] = useState(false);
	const [isLive, setIsLive] = useState(false);
	const wantsSlot = isNearViewport && !isPaused;

	useEffect(() => {
		if (!wantsSlot) {
			return;
		}
		const release = budget.acquire(() => setIsLive(true));
		return () => {
			release();
			setIsLive(false);
		};
	}, [wantsSlot, budget]);

	const pause = useCallback(() => setIsPaused(true), []);
	const resume = useCallback(() => setIsPaused(false), []);

	return { isLive, isPaused, pause, resume };
}

function useIsNearViewport(element: HTMLElement | null): boolean {
	const [isNearViewport, setIsNearViewport] = useState(false);

	useEffect(() => {
		if (!element) {
			return;
		}
		if (typeof IntersectionObserver === 'undefined') {
			setIsNearViewport(true);
			return () => setIsNearViewport(false);
		}
		const observer = new IntersectionObserver(
			(entries) => setIsNearViewport(entries[entries.length - 1].isIntersecting),
			{
				root: findScrollContainer(element),
				rootMargin: NEAR_VIEWPORT_MARGIN,
			},
		);
		observer.observe(element);
		return () => {
			observer.disconnect();
			setIsNearViewport(false);
		};
	}, [element]);

	return isNearViewport;
}

/** The margin only extends the observer root, so it must be the scrolling ancestor rather than the viewport, which would clip it. */
function findScrollContainer(element: HTMLElement): HTMLElement | null {
	for (let parent = element.parentElement; parent; parent = parent.parentElement) {
		const { overflowY } = getComputedStyle(parent);
		if (overflowY === 'auto' || overflowY === 'scroll') {
			return parent;
		}
	}
	return null;
}
