import { useEffect, useRef } from 'react';

export type PointerPosition = { x: number; y: number };

/**
 * Where the pointer is while a drag is in progress. The drag events only give the moved distance of the
 * dragged card, which modifiers shift away from the pointer. Listening in the capture phase updates the
 * position before the drag library handles the same move.
 */
export function useDragPointer(isDragging: boolean) {
	const pointerRef = useRef<PointerPosition | null>(null);

	useEffect(() => {
		if (!isDragging) {
			pointerRef.current = null;
			return;
		}
		const trackPointer = (event: PointerEvent) => {
			pointerRef.current = { x: event.clientX, y: event.clientY };
		};
		window.addEventListener('pointermove', trackPointer, { capture: true });
		return () => window.removeEventListener('pointermove', trackPointer, { capture: true });
	}, [isDragging]);

	return pointerRef;
}
