import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	claimDueJobs: vi.fn(),
	deleteJob: vi.fn(),
	enqueueOnceJob: vi.fn(),
	getJobById: vi.fn(),
	getProjectById: vi.fn(),
	hasProjectCloudBillingAccess: vi.fn(),
	isCloudFreeTierEnabled: vi.fn(),
	isUserReadOnlyInOrganization: vi.fn(),
	markJobFailed: vi.fn(),
	notifyScheduledWorkPaused: vi.fn(),
	reclaimStaleJobs: vi.fn(),
	rescheduleJob: vi.fn(),
	syncOrganizationSeatState: vi.fn(),
	upsertRecurringJob: vi.fn(),
}));

vi.mock('../src/queries/scheduled-job.queries', () => mocks);
vi.mock('../src/queries/project.queries', () => ({ getProjectById: mocks.getProjectById }));
vi.mock('../src/queries/organization-seat-state.queries', () => ({
	syncOrganizationSeatState: mocks.syncOrganizationSeatState,
}));
vi.mock('../src/env', () => ({ isCloudFreeTierEnabled: mocks.isCloudFreeTierEnabled }));
vi.mock('../src/services/cloud-billing-access.service', () => ({
	hasProjectCloudBillingAccess: mocks.hasProjectCloudBillingAccess,
	isUserReadOnlyInOrganization: mocks.isUserReadOnlyInOrganization,
}));
vi.mock('../src/services/scheduled-work-paused-notification.service', () => ({
	notifyScheduledWorkPaused: mocks.notifyScheduledWorkPaused,
}));

vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
	serializeError: (error: unknown) => ({ error: String(error) }),
}));

import { __resetSchedulerForTesting, registerJob, startScheduler } from '../src/services/scheduler.service';

describe('scheduler', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-28T10:00:00.000Z'));
		vi.clearAllMocks();
		mocks.getJobById.mockResolvedValue(null);
		mocks.getProjectById.mockResolvedValue({ id: 'project-1', orgId: 'org-1' });
		mocks.hasProjectCloudBillingAccess.mockResolvedValue(true);
		mocks.isCloudFreeTierEnabled.mockReturnValue(true);
		mocks.isUserReadOnlyInOrganization.mockResolvedValue(false);
		mocks.notifyScheduledWorkPaused.mockResolvedValue(undefined);
		mocks.reclaimStaleJobs.mockResolvedValue(0);
		mocks.syncOrganizationSeatState.mockResolvedValue(undefined);
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
			const resolveProjectPrincipal = vi
				.fn()
				.mockResolvedValue({ projectId: 'project-1', principalUserId: 'owner-1' });
			registerJob('story.refresh', handler, { resolveProjectPrincipal });
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

			expect(resolveProjectPrincipal).toHaveBeenCalledTimes(1);
			expect(mocks.hasProjectCloudBillingAccess).toHaveBeenCalledOnce();
			expect(mocks.hasProjectCloudBillingAccess).toHaveBeenCalledWith('project-1');
			expect(handler).toHaveBeenCalledTimes(expectedCalls);
			expect(mocks.rescheduleJob).toHaveBeenCalledWith('story-job', new Date('2026-09-28T11:00:00.000Z'));
			expect(mocks.markJobFailed).not.toHaveBeenCalled();
		},
	);

	it('marks read-only owner work successful after the durable notification claim', async () => {
		const handler = vi.fn();
		registerJob('story.refresh', handler, {
			resolveProjectPrincipal: vi.fn().mockResolvedValue({ projectId: 'project-1', principalUserId: 'owner-1' }),
		});
		mocks.isUserReadOnlyInOrganization.mockResolvedValue(true);
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

		expect(handler).not.toHaveBeenCalled();
		expect(mocks.notifyScheduledWorkPaused).toHaveBeenCalledWith({
			organizationId: 'org-1',
			userId: 'owner-1',
			projectId: 'project-1',
			resources: [{ type: 'story.refresh', id: 'story-1' }],
		});
		expect(mocks.rescheduleJob).toHaveBeenCalledWith('story-job', new Date('2026-09-28T11:00:00.000Z'));
		expect(mocks.markJobFailed).not.toHaveBeenCalled();
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
