export type LocalStorage<T> = {
	get: () => T;
	set: (value: T) => void;
};

export function createLocalStorage<T>(key: string, defaultValue: T): LocalStorage<T>;
export function createLocalStorage<T>(key: string): LocalStorage<T | null>;
export function createLocalStorage<T>(key: string, defaultValue?: T): LocalStorage<T | null> {
	return {
		get() {
			try {
				const stored = localStorage.getItem(key);
				if (stored) {
					const parsed = JSON.parse(stored);
					if (parsed != null) {
						return parsed as T;
					}
				}
			} catch {
				// Ignore parse errors
			}
			return (defaultValue ?? null) as T | null;
		},

		set(value: T | null) {
			localStorage.setItem(key, JSON.stringify(value));
		},
	};
}
