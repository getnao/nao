import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	claimDueJobs: vi.fn(),
	deleteJob: vi.fn(),
	enqueueOnceJob: vi.fn(),
	getJobById: vi.fn(),
	hasProjectCloudBillingAccess: vi.fn(),
	markJobFailed: vi.fn(),
	reclaimStaleJobs: vi.fn(),
	rescheduleJob: vi.fn(),
	upsertRecurringJob: vi.fn(),
}));

vi.mock('../src/queries/scheduled-job.queries', () => mocks);
vi.mock('../src/services/cloud-billing-access.service', () => ({
	hasProjectCloudBillingAccess: mocks.hasProjectCloudBillingAccess,
}));

vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn() },
	serializeError: (error: unknown) => ({ error: String(error) }),
}));

import { __resetSchedulerForTesting, registerJob, startScheduler } from '../src/services/scheduler.service';

describe('scheduler', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-28T10:00:00.000Z'));
		vi.clearAllMocks();
		mocks.getJobById.mockResolvedValue(null);
		mocks.hasProjectCloudBillingAccess.mockResolvedValue(true);
		mocks.reclaimStaleJobs.mockResolvedValue(0);
	});

	afterEach(async () => {
		await __resetSchedulerForTesting();
		vi.useRealTimers();
	});

	it.each([
		{ attempts: 1, nextRunAt: new Date('2026-09-28T10:01:00.000Z') },
		{ attempts: 10, nextRunAt: null },
	])('defers unhandled jobs until attempts are exhausted ($attempts)', async ({ attempts, nextRunAt }) => {
		mocks.claimDueJobs.mockResolvedValueOnce([
			{
				id: 'billing-job',
				name: 'stripe.webhook',
				payload: { eventId: 'evt_cloud' },
				runAt: new Date(),
				cron: null,
				status: 'running',
				attempts,
				maxAttempts: 10,
			},
		]);

		startScheduler();
		await vi.advanceTimersByTimeAsync(0);

		expect(mocks.markJobFailed).toHaveBeenCalledWith(
			'billing-job',
			"No handler registered for 'stripe.webhook'",
			nextRunAt,
		);
		expect(mocks.rescheduleJob).not.toHaveBeenCalled();
	});

	it('claims due jobs without filtering handler names', async () => {
		mocks.claimDueJobs.mockResolvedValueOnce([]);

		startScheduler();
		await vi.advanceTimersByTimeAsync(0);

		expect(mocks.claimDueJobs).toHaveBeenCalledWith(new Date('2026-09-28T10:00:00.000Z'), 10, expect.any(String));
	});

	it.each([
		{ hasAccess: false, expectedCalls: 0 },
		{ hasAccess: true, expectedCalls: 1 },
	])(
		'checks project access once before running a registered handler ($hasAccess)',
		async ({ hasAccess, expectedCalls }) => {
			const handler = vi.fn().mockResolvedValue(undefined);
			const resolveProjectId = vi.fn().mockResolvedValue('project-1');
			registerJob('story.refresh', handler, { resolveProjectId });
			mocks.hasProjectCloudBillingAccess.mockResolvedValue(hasAccess);
			mocks.claimDueJobs.mockResolvedValueOnce([
				{
					id: 'story-job',
					name: 'story.refresh',
					payload: { storyId: 'story-1' },
					runAt: new Date(),
					cron: '0 * * * *',
					status: 'running',
					attempts: 1,
					maxAttempts: 10,
				},
			]);

			startScheduler();
			await vi.advanceTimersByTimeAsync(0);

			expect(resolveProjectId).toHaveBeenCalledTimes(1);
			expect(mocks.hasProjectCloudBillingAccess).toHaveBeenCalledOnce();
			expect(mocks.hasProjectCloudBillingAccess).toHaveBeenCalledWith('project-1');
			expect(handler).toHaveBeenCalledTimes(expectedCalls);
			expect(mocks.rescheduleJob).toHaveBeenCalledWith('story-job', new Date('2026-09-28T11:00:00.000Z'));
			expect(mocks.markJobFailed).not.toHaveBeenCalled();
		},
	);

	it('waits for an active poll before resetting scheduler state', async () => {
		let finishClaim: (jobs: []) => void = () => undefined;
		mocks.claimDueJobs
			.mockImplementationOnce(
				() =>
					new Promise<[]>((resolve) => {
						finishClaim = resolve;
					}),
			)
			.mockResolvedValueOnce([]);
		startScheduler();

		let resetFinished = false;
		const resetPromise = __resetSchedulerForTesting().then(() => {
			resetFinished = true;
		});
		await Promise.resolve();
		const resetFinishedWhilePollActive = resetFinished;
		finishClaim([]);
		await resetPromise;

		expect(resetFinishedWhilePollActive).toBe(false);

		startScheduler();
		await vi.advanceTimersByTimeAsync(0);

		expect(mocks.claimDueJobs).toHaveBeenLastCalledWith(
			new Date('2026-09-28T10:00:00.000Z'),
			10,
			expect.any(String),
		);
	});
});
