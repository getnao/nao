const locks = new Map<string, Promise<unknown>>();

export async function withKeyedLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const previous = locks.get(key) ?? Promise.resolve();
	const current = previous.catch(() => undefined).then(fn);
	locks.set(key, current);
	try {
		return await current;
	} finally {
		if (locks.get(key) === current) {
			locks.delete(key);
		}
	}
}
