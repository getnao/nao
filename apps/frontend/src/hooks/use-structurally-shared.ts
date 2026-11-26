import { replaceEqualDeep } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';

/** Returns the previous value, or reuses its unchanged nested objects, when the new value is deep-equal to it. */
export function useStructurallyShared<T>(value: T): T {
	const previousRef = useRef(value);
	return useMemo(() => {
		const shared = replaceEqualDeep(previousRef.current, value);
		previousRef.current = shared;
		return shared;
	}, [value]);
}
