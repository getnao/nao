import { useMemo } from 'react';

/** Memoize an object using its values */
export const useMemoObject = <T extends object>(object: T) => {
	return useMemo<T>(() => object, Object.values(object)); // eslint-disable-line react-hooks/exhaustive-deps
};
