import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	hasAccess: vi.fn(),
	notifyUsers: vi.fn(),
	refreshStoryData: vi.fn(),
}));

vi.mock('../src/queries/scheduled-job.queries', () => ({ updateJobPayload: vi.fn() }));
vi.mock('../src/queries/shared-story.queries', () => ({
	getStoryShareAccess: vi.fn(async () => ({
		allowedUserIds: [],
		shareId: 'share-id',
		visibility: 'organization',
	})),
}));
vi.mock('../src/queries/story.queries', () => ({
	getStoryById: vi.fn(async () => ({
		id: 'story-id',
		archivedAt: null,
		chatId: 'chat-id',
		projectId: 'project-id',
		slug: 'story-slug',
		userId: 'user-id',
	})),
	getLatestVersionByChatAndSlug: vi.fn(async () => ({
		code: 'export default {}',
		title: 'Story title',
	})),
}));
vi.mock('../src/queries/story-delivery.queries', () => ({
	getByStoryId: vi.fn(async () => ({ channels: ['email'], enabled: true })),
}));
vi.mock('../src/queries/user.queries', () => ({
	getUserName: vi.fn(async () => 'Story owner'),
}));
vi.mock('../src/services/cloud-billing-access.service', () => ({
	hasProjectCloudBillingAccess: mocks.hasAccess,
}));
vi.mock('../src/services/live-story', () => ({ refreshStoryData: mocks.refreshStoryData }));
vi.mock('../src/services/notification.service', () => ({
	NotificationChannelDeliveryError: class extends Error {},
	notifyUsers: mocks.notifyUsers,
}));
vi.mock('../src/services/story-recipients', () => ({
	resolveDeliveryRecipientUserIds: vi.fn(async () => ['recipient-user-id']),
}));
vi.mock('../src/utils/keyed-lock', () => ({
	withKeyedLock: vi.fn(async (_key: string, callback: () => Promise<void>) => callback()),
}));
vi.mock('../src/utils/logger', () => ({ logger: { info: vi.fn() } }));
vi.mock('../src/utils/story-email', () => ({
	buildStoryEmailHtml: vi.fn(async () => null),
	buildStoryPdfAttachment: vi.fn(async () => []),
}));
vi.mock('../src/utils/story-links', () => ({
	sharedStoryPath: vi.fn(() => '/shared/share-id'),
}));

import { runScheduledStoryDelivery } from '../src/handlers/story-delivery.handler';

beforeEach(() => {
	vi.clearAllMocks();
	mocks.refreshStoryData.mockResolvedValue({ queryData: {} });
});

it('skips scheduled delivery when the project has no billing access', async () => {
	mocks.hasAccess.mockResolvedValue(false);

	await runScheduledStoryDelivery('story-id');

	expect(mocks.hasAccess).toHaveBeenCalledWith('project-id');
	expect(mocks.refreshStoryData).not.toHaveBeenCalled();
});

it('delivers the refreshed story when the project has billing access', async () => {
	mocks.hasAccess.mockResolvedValue(true);

	await runScheduledStoryDelivery('story-id');

	expect(mocks.refreshStoryData).toHaveBeenCalledWith('chat-id', 'story-slug');
	expect(mocks.notifyUsers).toHaveBeenCalledOnce();
	expect(mocks.notifyUsers).toHaveBeenCalledWith(
		['recipient-user-id'],
		expect.objectContaining({ channels: ['email'] }),
		{ skipDeliveries: [], throwOnChannelError: true },
	);
});
