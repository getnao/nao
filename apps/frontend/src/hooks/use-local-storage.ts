import { useCallback, useState } from 'react';
import type { LocalStorage } from '@/lib/local-storage';

export const useLocalStorage = <T>(storage: LocalStorage<T>) => {
	const [value, setValue] = useState<T>(() => {
		return storage.get();
	});

	const handleSetValue = useCallback(
		(
			v: Parameters<React.Dispatch<React.SetStateAction<T>>>[0],
			opts: { persist?: boolean } = { persist: true },
		) => {
			setValue((prev) => {
				const newValue = v instanceof Function ? v(prev) : v;
				if (opts.persist !== false) {
					storage.set(newValue);
				}
				return newValue;
			});
		},
		[storage],
	);

	return [value, handleSetValue] as const;
};
