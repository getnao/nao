import { useEffect, useRef, useState } from 'react';

import { useSelection } from '@/contexts/text-selection';
import { createRangeFromOffsets } from '@/lib/selection-dom.utils';

interface BubblePosition {
	centerX: number;
	top: number;
}

export function useTrackedBubbleRect(): BubblePosition | null {
	const { selection, containerRef } = useSelection();
	const [position, setPosition] = useState<BubblePosition | null>(null);
	const rangeRef = useRef<Range | null>(null);
	const rafId = useRef(0);

	useEffect(() => {
		if (!selection || !containerRef.current) {
			rangeRef.current = null;
			setPosition(null);
			return;
		}

		const range = createRangeFromOffsets(containerRef.current, selection.start, selection.end);
		rangeRef.current = range;

		if (!range) {
			setPosition(null);
			return;
		}

		function update() {
			const r = rangeRef.current;
			if (!r) {
				setPosition(null);
				return;
			}

			const rect = r.getBoundingClientRect();
			if (rect.bottom < 0 || rect.top > window.innerHeight) {
				setPosition(null);
				return;
			}

			setPosition({
				centerX: rect.left + rect.width / 2,
				top: rect.top - 6,
			});
		}

		update();

		function onScroll() {
			cancelAnimationFrame(rafId.current);
			rafId.current = requestAnimationFrame(update);
		}

		document.addEventListener('scroll', onScroll, { capture: true, passive: true });
		window.addEventListener('resize', onScroll, { passive: true });

		return () => {
			cancelAnimationFrame(rafId.current);
			document.removeEventListener('scroll', onScroll, { capture: true });
			window.removeEventListener('resize', onScroll);
		};
	}, [selection, containerRef]);

	return position;
}
