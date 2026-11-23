import { Effect, Schedule } from 'effect';

import dbConfig, { Dialect } from '../db/dbConfig';
import * as keyedLockQueries from '../queries/keyed-lock.queries';
import { fromPromise, runEffect, withHeartbeat } from './effect-runtime';
import { logger, serializeError } from './logger';

const LOCK_LEASE_MS = 2 * 60_000;
const LOCK_RENEW_INTERVAL_MS = 30_000;
const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 2 * 60_000;
const EXPIRED_LOCKS_CLEANUP_INTERVAL_MS = 60 * 60_000;

const inMemoryLocks = new Map<string, Promise<unknown>>();
let lastExpiredLocksCleanupAt = 0;

export async function withKeyedLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	if (dbConfig.dialect !== Dialect.Postgres) {
		return withInMemoryLock(key, fn);
	}
	return withDatabaseLock(key, fn);
}

/**
 * Claims `key` across every backend instance sharing the database. Only the first caller gets
 * `true`; later callers get `false` until the lease expires. The claim is never released.
 */
export async function claimOnce(key: string, leaseMs: number): Promise<boolean> {
	const claimed = await keyedLockQueries.tryAcquireLock(key, crypto.randomUUID(), leaseMs);
	if (claimed) {
		scheduleExpiredLocksCleanup();
	}
	return claimed;
}

function scheduleExpiredLocksCleanup(): void {
	if (Date.now() - lastExpiredLocksCleanupAt < EXPIRED_LOCKS_CLEANUP_INTERVAL_MS) {
		return;
	}
	lastExpiredLocksCleanupAt = Date.now();
	void deleteExpiredLocksSafely();
}

async function deleteExpiredLocksSafely(): Promise<void> {
	try {
		await keyedLockQueries.deleteExpiredLocks();
	} catch (error) {
		logger.warn('Failed to delete expired keyed locks.', { source: 'system', context: serializeError(error) });
	}
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

function withDatabaseLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const owner = crypto.randomUUID();
	return runEffect(
		Effect.acquireUseRelease(
			acquireLock(key, owner),
			() =>
				fromPromise(() => fn()).pipe(
					withHeartbeat({
						name: `Lease renewal of lock "${key}"`,
						beat: () => renewLease(key, owner),
						every: LOCK_RENEW_INTERVAL_MS,
					}),
				),
			() => fromPromise(() => releaseLockSafely(key, owner)).pipe(Effect.ignore),
		),
	);
}

async function releaseLockSafely(key: string, owner: string): Promise<void> {
	try {
		await keyedLockQueries.releaseLock(key, owner);
	} catch (error) {
		logger.warn(`Failed to release lock "${key}"; it will expire when its lease ends.`, {
			source: 'system',
			context: serializeError(error),
		});
	}
}

/** Tries again every half second for up to two minutes, and never gives up on an attempt still in flight. */
function acquireLock(key: string, owner: string): Effect.Effect<void, unknown> {
	return fromPromise(() => keyedLockQueries.tryAcquireLock(key, owner, LOCK_LEASE_MS)).pipe(
		Effect.repeat({
			schedule: Schedule.spaced(POLL_INTERVAL_MS).pipe(Schedule.upTo({ duration: MAX_WAIT_MS })),
			until: (acquired) => acquired,
		}),
		Effect.filterOrFail(
			(acquired) => acquired,
			() => new Error(`Timed out waiting for lock "${key}" held by another process.`),
		),
		Effect.asVoid,
	);
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
