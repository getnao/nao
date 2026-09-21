import { useEffect } from 'react';
import type { RefObject } from 'react';

const HOT_ZONE = 80;
const MAX_SPEED = 22;

export function useDragAutoScroll(scrollContainerRef: RefObject<HTMLElement | null>): void {
	useEffect(() => {
		let velocity = 0;
		let frame: number | null = null;

		const step = () => {
			if (scrollContainerRef.current && velocity !== 0) {
				scrollContainerRef.current.scrollTop += velocity;
				frame = requestAnimationFrame(step);
			} else {
				frame = null;
			}
		};

		const handleDragOver = (event: DragEvent) => {
			const container = scrollContainerRef.current;
			if (!container) {
				return;
			}

			velocity = computeAutoScrollVelocity(container.getBoundingClientRect(), event.clientX, event.clientY);
			if (velocity !== 0 && frame === null) {
				frame = requestAnimationFrame(step);
			}
		};

		const stop = () => {
			velocity = 0;
			if (frame !== null) {
				cancelAnimationFrame(frame);
				frame = null;
			}
		};

		document.addEventListener('dragover', handleDragOver);
		document.addEventListener('drop', stop);
		document.addEventListener('dragend', stop);

		return () => {
			document.removeEventListener('dragover', handleDragOver);
			document.removeEventListener('drop', stop);
			document.removeEventListener('dragend', stop);
			stop();
		};
	}, [scrollContainerRef]);
}

export function computeAutoScrollVelocity(rect: DOMRect, clientX: number, clientY: number): number {
	if (clientX < rect.left || clientX > rect.right) {
		return 0;
	}

	const distanceFromTop = clientY - rect.top;
	const distanceFromBottom = rect.bottom - clientY;

	if (distanceFromTop < HOT_ZONE) {
		return -MAX_SPEED * clamp01((HOT_ZONE - distanceFromTop) / HOT_ZONE);
	}
	if (distanceFromBottom < HOT_ZONE) {
		return MAX_SPEED * clamp01((HOT_ZONE - distanceFromBottom) / HOT_ZONE);
	}
	return 0;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}
