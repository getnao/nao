import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../helpers/logger-mock';

vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

import { fromPromise, repeatInBackground, runEffect, withHeartbeat } from '../../src/utils/effect-runtime';

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('repeatInBackground', () => {
	it('logs a failed run and still runs the next ones', async () => {
		const task = vi.fn().mockRejectedValueOnce(new Error('database is down')).mockResolvedValue(undefined);

		const stop = repeatInBackground('Stream sweep', fromPromise(task), 1_000, { immediately: true });
		await vi.advanceTimersByTimeAsync(2_000);
		await stop();
		await vi.advanceTimersByTimeAsync(5_000);

		expect(task).toHaveBeenCalledTimes(3);
		expect(logger.error).toHaveBeenCalledOnce();
		expect(logger.error).toHaveBeenCalledWith('Stream sweep failed: database is down', expect.anything());
	});
});

describe('withHeartbeat', () => {
	it('beats while the operation runs and stops once it settles', async () => {
		const beat = vi.fn().mockResolvedValue(undefined);
		let finish: () => void = () => undefined;
		const operation = new Promise<string>((resolve) => {
			finish = () => resolve('transferred');
		});

		const result = runEffect(
			fromPromise(() => operation).pipe(withHeartbeat({ name: 'Lease', beat, every: 1_000 })),
		);
		await vi.advanceTimersByTimeAsync(2_500);
		finish();

		await expect(result).resolves.toBe('transferred');
		await vi.advanceTimersByTimeAsync(5_000);
		expect(beat).toHaveBeenCalledTimes(2);
	});

	it('rejects with the operation’s own error', async () => {
		class StoryLockedError extends Error {}
		const beat = vi.fn().mockResolvedValue(undefined);

		const result = runEffect(
			fromPromise(() => Promise.reject(new StoryLockedError('locked'))).pipe(
				withHeartbeat({ name: 'Lease', beat, every: 1_000 }),
			),
		);

		await expect(result).rejects.toBeInstanceOf(StoryLockedError);
	});
});
