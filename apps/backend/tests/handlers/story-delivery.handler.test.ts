import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getStoryById: vi.fn(),
	notifyUsers: vi.fn(),
	refreshStoryById: vi.fn(),
	updateJobPayload: vi.fn(),
}));

vi.mock('../../src/queries/scheduled-job.queries', () => ({ updateJobPayload: mocks.updateJobPayload }));
vi.mock('../../src/queries/shared-story.queries', () => ({
	getStoryShareAccess: vi.fn(async () => ({
		allowedUserIds: [],
		shareId: 'share-id',
		visibility: 'organization',
	})),
}));
vi.mock('../../src/queries/story.queries', () => ({
	getStoryById: mocks.getStoryById,
	getLatestVersionByStoryId: vi.fn(async () => ({
		code: 'export default {}',
		title: 'Story title',
	})),
}));
vi.mock('../../src/queries/story-delivery.queries', () => ({
	getByStoryId: vi.fn(async () => ({ channels: ['email'], enabled: true })),
}));
vi.mock('../../src/queries/user.queries', () => ({
	getUserName: vi.fn(async () => 'Story owner'),
}));
vi.mock('../../src/services/live-story', () => ({ refreshStoryById: mocks.refreshStoryById }));
vi.mock('../../src/services/notification.service', () => ({
	NotificationChannelDeliveryError: class extends Error {
		constructor(
			readonly succeeded: Array<{ userId: string; channel: string }>,
			readonly failed: Array<{ userId: string; channel: string }>,
		) {
			super('Notification channel delivery failed');
		}
	},
	notifyUsers: mocks.notifyUsers,
}));
vi.mock('../../src/services/story-recipients', () => ({
	resolveDeliveryRecipientUserIds: vi.fn(async () => ['recipient-user-id']),
}));
vi.mock('../../src/utils/keyed-lock', () => ({
	withKeyedLock: vi.fn(async (_key: string, callback: () => Promise<void>) => callback()),
}));
vi.mock('../../src/utils/logger', () => ({ logger: { info: vi.fn() } }));
vi.mock('../../src/utils/story-email', () => ({
	buildStoryEmailHtml: vi.fn(async () => null),
	buildStoryPdfAttachment: vi.fn(async () => []),
}));
vi.mock('../../src/utils/story-links', () => ({
	storyPath: vi.fn(() => '/stories/story-id'),
}));

import {
	resolveStoryDeliveryProjectId,
	runScheduledStoryDelivery,
	storyDeliveryHandler,
} from '../../src/handlers/story-delivery.handler';
import { NotificationChannelDeliveryError } from '../../src/services/notification.service';

const STORY = {
	id: 'story-id',
	archivedAt: null,
	chatId: 'chat-id',
	projectId: 'project-id',
	slug: 'story-slug',
	userId: 'user-id',
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getStoryById.mockResolvedValue(STORY);
	mocks.refreshStoryById.mockResolvedValue({ queryData: {} });
});

it.each([
	['in a chat', 'chat-id'],
	['standalone', null],
])('delivers the refreshed story %s with scheduler-verified billing access', async (_case, chatId) => {
	mocks.getStoryById.mockResolvedValue({ ...STORY, chatId });

	await runScheduledStoryDelivery('story-id');

	expect(mocks.refreshStoryById).toHaveBeenCalledWith('story-id', {
		billingAccessVerifiedProjectId: 'project-id',
	});
	expect(mocks.notifyUsers).toHaveBeenCalledOnce();
	expect(mocks.notifyUsers).toHaveBeenCalledWith(
		['recipient-user-id'],
		expect.objectContaining({ channels: ['email'] }),
		{ skipDeliveries: [], throwOnChannelError: true },
	);
});

it('lets the handler no-op when the scheduled story no longer exists', async () => {
	mocks.getStoryById.mockResolvedValueOnce(undefined);

	await expect(resolveStoryDeliveryProjectId({ storyId: 'deleted-story-id' })).resolves.toBeNull();
});

it('preserves successful channels when the scheduler retries delivery', async () => {
	const previousSkips = [{ userId: 'recipient-user-id', channel: 'slack' as const }];
	const newlySucceeded = [{ userId: 'recipient-user-id', channel: 'email' as const }];
	const error = new NotificationChannelDeliveryError(newlySucceeded, [
		{ userId: 'recipient-user-id', channel: 'in_app' },
	]);
	mocks.notifyUsers.mockRejectedValueOnce(error);

	await expect(
		storyDeliveryHandler({ storyId: 'story-id', skipDeliveries: previousSkips }, { id: 'job-id' } as never),
	).rejects.toBe(error);

	expect(mocks.notifyUsers).toHaveBeenCalledWith(
		['recipient-user-id'],
		expect.objectContaining({ channels: ['email'] }),
		{ skipDeliveries: previousSkips, throwOnChannelError: true },
	);
	expect(mocks.updateJobPayload).toHaveBeenCalledWith('job-id', {
		storyId: 'story-id',
		skipDeliveries: [...previousSkips, ...newlySucceeded],
	});
});
