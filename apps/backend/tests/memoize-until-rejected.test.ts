import { describe, expect, it, vi } from 'vitest';

import { memoizeUntilRejected } from '../src/utils/memoize-until-rejected';

describe('memoizeUntilRejected', () => {
	it('shares a single resolved promise across callers', async () => {
		const create = vi.fn().mockResolvedValue('auth');
		const memoized = memoizeUntilRejected(create);

		await expect(Promise.all([memoized.get(), memoized.get()])).resolves.toEqual(['auth', 'auth']);
		await expect(memoized.get()).resolves.toBe('auth');
		expect(create).toHaveBeenCalledTimes(1);
	});

	it('retries on the next call after a rejection instead of replaying it', async () => {
		const create = vi
			.fn()
			.mockRejectedValueOnce(new Error('Failed query: select count(*) from "user"'))
			.mockResolvedValue('auth');
		const memoized = memoizeUntilRejected(create);

		await expect(memoized.get()).rejects.toThrow('Failed query');
		await expect(memoized.get()).resolves.toBe('auth');
		await expect(memoized.get()).resolves.toBe('auth');
		expect(create).toHaveBeenCalledTimes(2);
	});

	it('rejects every caller of the same in-flight attempt', async () => {
		const create = vi.fn().mockRejectedValueOnce(new Error('connection reset')).mockResolvedValue('auth');
		const memoized = memoizeUntilRejected(create);

		const results = await Promise.allSettled([memoized.get(), memoized.get()]);
		expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
		expect(create).toHaveBeenCalledTimes(1);
	});

	it('keeps a newer promise when an older attempt rejects after a reset', async () => {
		let rejectFirst: (error: Error) => void = () => {};
		const create = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise((_, reject) => {
						rejectFirst = reject;
					}),
			)
			.mockResolvedValue('fresh auth');
		const memoized = memoizeUntilRejected(create);

		const first = memoized.get();
		memoized.reset();
		await expect(memoized.get()).resolves.toBe('fresh auth');

		rejectFirst(new Error('stale failure'));
		await expect(first).rejects.toThrow('stale failure');
		await expect(memoized.get()).resolves.toBe('fresh auth');
		expect(create).toHaveBeenCalledTimes(2);
	});
});
