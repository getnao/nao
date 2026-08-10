import { useEffect, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';

const BREAKOUT_EDGE_PADDING = 16;

export function useBreakoutStyle(
	slotRef: RefObject<HTMLDivElement | null>,
	enabled: boolean,
): CSSProperties | undefined {
	const [style, setStyle] = useState<CSSProperties>();

	useEffect(() => {
		const slot = slotRef.current;
		if (!enabled || !slot) {
			setStyle(undefined);
			return;
		}
		const pane = findScrollPane(slot);
		if (!pane) {
			setStyle(undefined);
			return;
		}

		const compute = () => {
			const slotRect = slot.getBoundingClientRect();
			const paneRect = pane.getBoundingClientRect();
			const leftRoom = slotRect.left - paneRect.left - BREAKOUT_EDGE_PADDING;
			const rightRoom = paneRect.right - slotRect.right - BREAKOUT_EDGE_PADDING;
			const extra = Math.max(0, Math.min(leftRoom, rightRoom));
			setStyle(
				extra > 0 ? { width: slotRect.width + extra * 2, marginLeft: -extra, marginRight: -extra } : undefined,
			);
		};

		compute();
		const observer = new ResizeObserver(compute);
		observer.observe(pane);
		observer.observe(slot);
		return () => observer.disconnect();
	}, [enabled, slotRef]);

	return enabled ? style : undefined;
}

function findScrollPane(element: HTMLElement): HTMLElement | null {
	let current = element.parentElement;
	while (current) {
		const overflowY = getComputedStyle(current).overflowY;
		if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') {
			return current;
		}
		current = current.parentElement;
	}
	return null;
}
