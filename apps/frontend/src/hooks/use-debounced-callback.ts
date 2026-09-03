import { useCallback, useEffect, useRef } from 'react';

export function useDebouncedCallback<Args extends unknown[]>(
	callback: (...args: Args) => void,
	delayMs: number,
): (...args: Args) => void {
	const callbackRef = useRef(callback);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	callbackRef.current = callback;

	useEffect(
		() => () => {
			clearPendingCallback(timeoutRef);
		},
		[],
	);

	return useCallback(
		(...args: Args) => {
			clearPendingCallback(timeoutRef);
			timeoutRef.current = setTimeout(() => {
				timeoutRef.current = null;
				callbackRef.current(...args);
			}, delayMs);
		},
		[delayMs],
	);
}

function clearPendingCallback(timeoutRef: React.RefObject<ReturnType<typeof setTimeout> | null>) {
	if (timeoutRef.current !== null) {
		clearTimeout(timeoutRef.current);
		timeoutRef.current = null;
	}
}
