import { useRef } from 'react';

export const useCurrent = <T>(value: T) => {
	const ref = useRef<T>(value);
	ref.current = value;
	return ref;
};
