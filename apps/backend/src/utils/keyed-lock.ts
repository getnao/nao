import dbConfig, { Dialect } from '../db/dbConfig';
import * as keyedLockQueries from '../queries/keyed-lock.queries';
import { logger, serializeError } from './logger';

const LOCK_LEASE_MS = 2 * 60_000;
const LOCK_RENEW_INTERVAL_MS = 30_000;
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
	const owner = crypto.randomUUID();
	await acquireLock(key, owner);
	const stopRenewingLease = startLeaseRenewal(key, owner);
	try {
		return await fn();
	} finally {
		stopRenewingLease();
		await keyedLockQueries.releaseLock(key, owner);
	}
}

async function acquireLock(key: string, owner: string): Promise<void> {
	const deadline = Date.now() + MAX_WAIT_MS;
	for (;;) {
		if (await keyedLockQueries.tryAcquireLock(key, owner, LOCK_LEASE_MS)) {
			return;
		}
		if (Date.now() >= deadline) {
			throw new Error(`Timed out waiting for lock "${key}" held by another process.`);
		}
		await sleep(POLL_INTERVAL_MS);
	}
}

function startLeaseRenewal(key: string, owner: string): () => void {
	const timer = setInterval(() => {
		void renewLease(key, owner);
	}, LOCK_RENEW_INTERVAL_MS);
	return () => clearInterval(timer);
}

async function renewLease(key: string, owner: string): Promise<void> {
	try {
		const renewed = await keyedLockQueries.renewLock(key, owner, LOCK_LEASE_MS);
		if (!renewed) {
			logger.warn(`Lost lease on lock "${key}" while still running; another process may have taken it over.`, {
				source: 'system',
			});
		}
	} catch (error) {
		logger.warn(`Failed to renew lease on lock "${key}".`, { source: 'system', context: serializeError(error) });
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
