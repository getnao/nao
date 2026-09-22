import { useEffect, useRef, useState } from 'react';

export function useThrottledValue<T>(value: T, interval: number, enabled = true): T {
	const [throttledValue, setThrottledValue] = useState(value);
	const pendingValueRef = useRef(value);
	const lastUpdateAtRef = useRef(0);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const wasEnabledRef = useRef(false);

	useEffect(() => {
		pendingValueRef.current = value;

		if (!enabled) {
			clearScheduledUpdate(timeoutRef);
			lastUpdateAtRef.current = 0;
			wasEnabledRef.current = false;
			setThrottledValue(value);
			return;
		}

		const now = Date.now();
		if (!wasEnabledRef.current) {
			clearScheduledUpdate(timeoutRef);
			wasEnabledRef.current = true;
			lastUpdateAtRef.current = now;
			setThrottledValue(value);
			return;
		}

		const remaining = interval - (now - lastUpdateAtRef.current);
		if (remaining <= 0) {
			clearScheduledUpdate(timeoutRef);
			lastUpdateAtRef.current = now;
			setThrottledValue(value);
			return;
		}

		clearScheduledUpdate(timeoutRef);
		timeoutRef.current = setTimeout(() => {
			timeoutRef.current = null;
			lastUpdateAtRef.current = Date.now();
			setThrottledValue(pendingValueRef.current);
		}, remaining);
	}, [enabled, interval, value]);

	useEffect(
		() => () => {
			clearScheduledUpdate(timeoutRef);
		},
		[],
	);

	return enabled ? throttledValue : value;
}

function clearScheduledUpdate(timeoutRef: React.RefObject<ReturnType<typeof setTimeout> | null>) {
	if (timeoutRef.current !== null) {
		clearTimeout(timeoutRef.current);
		timeoutRef.current = null;
	}
}
