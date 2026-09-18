import dbConfig, { Dialect } from '../db/dbConfig';
import * as keyedLockQueries from '../queries/keyed-lock.queries';

const LOCK_LEASE_MS = 10 * 60_000;
const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 2 * 60_000;

const inMemoryLocks = new Map<string, Promise<unknown>>();

export async function withKeyedLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	if (dbConfig.dialect !== Dialect.Postgres) {
		return withInMemoryLock(key, fn);
	}
	return withDatabaseLock(key, fn);
}

function withInMemoryLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const previous = inMemoryLocks.get(key) ?? Promise.resolve();
	const current = previous.catch(() => undefined).then(fn);
	inMemoryLocks.set(key, current);
	return current.finally(() => {
		if (inMemoryLocks.get(key) === current) {
			inMemoryLocks.delete(key);
		}
	});
}

async function withDatabaseLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const deadline = Date.now() + MAX_WAIT_MS;
	for (;;) {
		if (await keyedLockQueries.tryAcquireLock(key, LOCK_LEASE_MS)) {
			break;
		}
		if (Date.now() >= deadline) {
			throw new Error(`Timed out waiting for lock "${key}" held by another process.`);
		}
		await sleep(POLL_INTERVAL_MS);
	}
	try {
		return await fn();
	} finally {
		await keyedLockQueries.releaseLock(key);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
