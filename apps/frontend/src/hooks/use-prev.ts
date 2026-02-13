import { useEffect, useRef } from 'react';

/** Returns a ref that points to the previous value of the given value. */
export const usePrevRef = <T>(value: T) => {
	const prevRef = useRef<T | undefined>(undefined);

	useEffect(() => {
		return () => {
			prevRef.current = value;
		};
	}, [value]);

	return prevRef;
};
