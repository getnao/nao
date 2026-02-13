import { useEffect, useRef } from 'react';

export const usePrevRef = <T>(value: T) => {
	const prevRef = useRef<T | undefined>(undefined);

	useEffect(() => {
		return () => {
			prevRef.current = value;
		};
	}, [value]);

	return prevRef;
};
