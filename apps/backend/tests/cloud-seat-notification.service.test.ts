import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	isReadOnly: false,
	inAppClaimed: false,
	emailClaimedAt: null as Date | null,
}));

const mocks = vi.hoisted(() => ({
	claimInApp: vi.fn(),
	claimEmail: vi.fn(),
	releaseEmail: vi.fn(),
	syncState: vi.fn(),
}));

vi.mock('../src/queries/organization-seat-state.queries', () => ({
	claimPausedWorkInAppNotification: mocks.claimInApp,
	claimOrganizationSeatEmailNotification: mocks.claimEmail,
	listScheduledWorkResourcesForOwner: vi.fn(async () => []),
	releaseOrganizationSeatEmailNotification: mocks.releaseEmail,
	syncOrganizationSeatState: mocks.syncState,
}));

import { notifyScheduledWorkPaused } from '../src/services/scheduled-work-paused-notification.service';

const input = {
	organizationId: 'org-id',
	userId: 'user-id',
	projectId: 'project-id',
	resources: [{ type: 'automation', id: 'automation-id' }],
};

describe('scheduled work paused notifications', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.isReadOnly = false;
		state.inAppClaimed = false;
		state.emailClaimedAt = null;
		mocks.syncState.mockImplementation(async ({ isReadOnly }: { isReadOnly: boolean }) => {
			if (state.isReadOnly !== isReadOnly) {
				state.isReadOnly = isReadOnly;
				state.inAppClaimed = false;
				state.emailClaimedAt = null;
			}
			return { changed: true };
		});
		mocks.claimInApp.mockImplementation(async () => {
			if (state.inAppClaimed) {
				return false;
			}
			state.inAppClaimed = true;
			return true;
		});
		mocks.claimEmail.mockImplementation(async (_orgId, _userId, _channel, claimedAt: Date) => {
			if (state.emailClaimedAt) {
				return false;
			}
			state.emailClaimedAt = claimedAt;
			return true;
		});
		mocks.releaseEmail.mockImplementation(async (_orgId, _userId, _channel, claimedAt: Date) => {
			if (state.emailClaimedAt?.getTime() !== claimedAt.getTime()) {
				return false;
			}
			state.emailClaimedAt = null;
			return true;
		});
	});

	it('delivers once per read-only episode and resets after reseating', async () => {
		const deliverEmail = vi.fn(async () => undefined);

		await notifyScheduledWorkPaused(input, deliverEmail);
		await notifyScheduledWorkPaused(input, deliverEmail);

		expect(deliverEmail).toHaveBeenCalledOnce();

		await mocks.syncState({ isReadOnly: false });
		await notifyScheduledWorkPaused(input, deliverEmail);

		expect(deliverEmail).toHaveBeenCalledTimes(2);
	});

	it('releases only the email claim after an observed SMTP failure', async () => {
		const smtpFailure = new Error('SMTP unavailable');
		const deliverEmail = vi.fn().mockRejectedValueOnce(smtpFailure).mockResolvedValueOnce(undefined);

		await expect(notifyScheduledWorkPaused(input, deliverEmail)).rejects.toBe(smtpFailure);
		await expect(notifyScheduledWorkPaused(input, deliverEmail)).resolves.toBeUndefined();

		expect(mocks.releaseEmail).toHaveBeenCalledOnce();
		expect(deliverEmail).toHaveBeenCalledTimes(2);
		expect(state.inAppClaimed).toBe(true);
	});
});
