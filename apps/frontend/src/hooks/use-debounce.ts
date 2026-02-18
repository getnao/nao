import { debounce } from '@nao/shared';
import { useMemo } from 'react';

export const useDebounce = <T extends (...args: any[]) => any>(
	func: T,
	delay: number,
	deps: React.DependencyList = [],
): ((...args: Parameters<T>) => void) => {
	const debounced = useMemo(() => debounce(func, delay), deps); // eslint-disable-line react-hooks/exhaustive-deps
	return debounced;
};
