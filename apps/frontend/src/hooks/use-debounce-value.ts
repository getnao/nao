import { useEffect, useState } from 'react';

export const useDebounceValue = <T>(value: T, opts: { delay: number; skipDebounce?: (v: T) => boolean }) => {
	const { delay, skipDebounce } = opts;
	const [debouncedValue, setDebouncedValue] = useState(value);

	useEffect(() => {
		if (skipDebounce && skipDebounce(value)) {
			setDebouncedValue(value);
			return;
		}

		const timeout = setTimeout(() => setDebouncedValue(value), delay);
		return () => clearTimeout(timeout);
	}, [value, delay]); // eslint-disable-line react-hooks/exhaustive-deps

	return debouncedValue;
};
