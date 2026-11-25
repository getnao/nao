import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	claimDueJobs: vi.fn(),
	deleteJob: vi.fn(),
	enqueueOnceJob: vi.fn(),
	getJobById: vi.fn(),
	hasProjectCloudBillingAccess: vi.fn(),
	isProjectUserReadOnly: vi.fn(),
	markJobFailed: vi.fn(),
	notifyScheduledWorkPaused: vi.fn(),
	reclaimStaleJobs: vi.fn(),
	rescheduleJob: vi.fn(),
	upsertRecurringJob: vi.fn(),
}));

vi.mock('../../src/queries/scheduled-job.queries', () => mocks);
vi.mock('../../src/services/cloud-billing-access.service', () => ({
	hasProjectCloudBillingAccess: mocks.hasProjectCloudBillingAccess,
	isProjectUserReadOnly: mocks.isProjectUserReadOnly,
}));
vi.mock('../../src/services/seat-notification.service', () => ({
	notifyScheduledWorkPaused: mocks.notifyScheduledWorkPaused,
}));

vi.mock('../../src/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
	serializeError: (error: unknown) => ({ error: String(error) }),
}));

import { __resetSchedulerForTesting, registerJob, startScheduler } from '../../src/services/scheduler.service';

describe('scheduler', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-28T10:00:00.000Z'));
		vi.clearAllMocks();
		mocks.getJobById.mockResolvedValue(null);
		mocks.hasProjectCloudBillingAccess.mockResolvedValue(true);
		mocks.isProjectUserReadOnly.mockResolvedValue(false);
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
		{ hasAccess: false, ownerReadOnly: false, expectedCalls: 0 },
		{ hasAccess: true, ownerReadOnly: true, expectedCalls: 0 },
		{ hasAccess: true, ownerReadOnly: false, expectedCalls: 1 },
	])(
		'checks project access and owner seat before running a registered handler ($hasAccess, $ownerReadOnly)',
		async ({ hasAccess, ownerReadOnly, expectedCalls }) => {
			const handler = vi.fn().mockResolvedValue(undefined);
			const resolveScope = vi.fn().mockResolvedValue({ projectId: 'project-1', ownerId: 'owner-1' });
			registerJob('story.refresh', handler, { resolveScope });
			mocks.hasProjectCloudBillingAccess.mockResolvedValue(hasAccess);
			mocks.isProjectUserReadOnly.mockResolvedValue(ownerReadOnly);
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

			expect(resolveScope).toHaveBeenCalledTimes(1);
			expect(mocks.hasProjectCloudBillingAccess).toHaveBeenCalledOnce();
			expect(mocks.hasProjectCloudBillingAccess).toHaveBeenCalledWith('project-1');
			expect(handler).toHaveBeenCalledTimes(expectedCalls);
			expect(mocks.notifyScheduledWorkPaused).toHaveBeenCalledTimes(hasAccess && ownerReadOnly ? 1 : 0);
			expect(mocks.rescheduleJob).toHaveBeenCalledWith('story-job', new Date('2026-09-28T11:00:00.000Z'));
			expect(mocks.markJobFailed).not.toHaveBeenCalled();
		},
	);

	it('keeps a one-off job of a project without access for a later run', async () => {
		const handler = vi.fn().mockResolvedValue(undefined);
		registerJob('story.delivery', handler, { resolveScope: () => ({ projectId: 'project-1' }) });
		mocks.hasProjectCloudBillingAccess.mockResolvedValue(false);
		mocks.claimDueJobs.mockResolvedValueOnce([
			{
				id: 'delivery-retry',
				name: 'story.delivery',
				payload: { storyId: 'story-1' },
				runAt: new Date(),
				cron: null,
				status: 'running',
				attempts: 1,
				maxAttempts: 10,
			},
		]);

		startScheduler();
		await vi.advanceTimersByTimeAsync(0);

		expect(handler).not.toHaveBeenCalled();
		expect(mocks.deleteJob).not.toHaveBeenCalled();
		expect(mocks.rescheduleJob).toHaveBeenCalledWith('delivery-retry', new Date('2026-09-28T11:00:00.000Z'));
	});

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
