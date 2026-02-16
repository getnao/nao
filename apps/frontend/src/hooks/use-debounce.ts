import { useEffect, useState } from 'react';

export const useDebounce = <T>(opts: { value: T; delay: number; skipDebounce?: (v: T) => boolean }) => {
	const { value, delay, skipDebounce } = opts;
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
