export interface MemoizedPromise<T> {
	get: () => Promise<T>;
	reset: () => void;
}

/**
 * Shares one in-flight or resolved promise across callers, but forgets it once it rejects
 * so a transient failure (e.g. a database blip) is retried by the next caller instead of
 * being replayed for the lifetime of the process.
 */
export function memoizeUntilRejected<T>(create: () => Promise<T>): MemoizedPromise<T> {
	let current: Promise<T> | null = null;

	const get = (): Promise<T> => {
		if (current) {
			return current;
		}
		const pending = create();
		current = pending;
		pending.catch(() => {
			if (current === pending) {
				current = null;
			}
		});
		return pending;
	};

	const reset = () => {
		current = null;
	};

	return { get, reset };
}
