import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	tryAcquireLock: vi.fn(),
	renewLock: vi.fn(),
	releaseLock: vi.fn(),
	deleteExpiredLocks: vi.fn(),
}));

vi.mock('../../src/queries/keyed-lock.queries', () => mocks);
vi.mock('../../src/db/dbConfig', () => ({
	default: { dialect: 'postgres' },
	Dialect: { Postgres: 'postgres', Sqlite: 'sqlite' },
}));
vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

import { withKeyedLock } from '../../src/utils/keyed-lock';

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	mocks.renewLock.mockResolvedValue(true);
	mocks.releaseLock.mockResolvedValue(undefined);
});

afterEach(() => {
	vi.useRealTimers();
});

it('waits for the lock to be free, runs the work and releases the lock', async () => {
	mocks.tryAcquireLock.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
	const work = vi.fn().mockResolvedValue('refreshed');

	const result = withKeyedLock('story:1', work);
	await vi.advanceTimersByTimeAsync(1_000);

	await expect(result).resolves.toBe('refreshed');
	expect(mocks.tryAcquireLock).toHaveBeenCalledTimes(3);
	expect(mocks.releaseLock).toHaveBeenCalledWith('story:1', mocks.tryAcquireLock.mock.calls[0][1]);
});

it('gives up after two minutes without running the work', async () => {
	mocks.tryAcquireLock.mockResolvedValue(false);
	const work = vi.fn();

	const result = withKeyedLock('story:1', work);
	const assertion = expect(result).rejects.toThrow('Timed out waiting for lock "story:1" held by another process.');
	await vi.advanceTimersByTimeAsync(2 * 60_000 + 1_000);

	await assertion;
	expect(work).not.toHaveBeenCalled();
	expect(mocks.releaseLock).not.toHaveBeenCalled();
});
