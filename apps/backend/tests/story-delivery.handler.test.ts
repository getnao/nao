import { beforeEach, expect, it, vi } from 'vitest';

import type { DBStory } from '../src/db/abstractSchema';

const mocks = vi.hoisted(() => ({
	getStoryById: vi.fn<(_storyId: string) => Promise<DBStory | undefined>>(async () => {
		return {
			id: 'story-id',
			archivedAt: null,
			chatId: 'chat-id',
			projectId: 'project-id',
			slug: 'story-slug',
			userId: 'user-id',
		} as DBStory;
	}),
	notifyUsers: vi.fn(),
	refreshStoryData: vi.fn(),
	refreshStoryDataForDelivery: vi.fn(),
	hasRowSecurity: vi.fn(),
	resolveDeliveryRecipientUserIds: vi.fn(),
	buildStoryEmailHtml: vi.fn(),
	buildStoryPdfAttachment: vi.fn(),
	renderCustomStoryPdf: vi.fn(),
	logError: vi.fn(),
	updateJobPayload: vi.fn(),
}));

vi.mock('../src/queries/scheduled-job.queries', () => ({ updateJobPayload: mocks.updateJobPayload }));
vi.mock('../src/queries/shared-story.queries', () => ({
	getStoryShareAccess: vi.fn(async () => ({
		allowedUserIds: [],
		shareId: 'share-id',
		visibility: 'organization',
	})),
}));
vi.mock('../src/queries/story.queries', () => ({
	getStoryById: mocks.getStoryById,
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
vi.mock('../src/services/custom-story-export', () => ({
	renderCustomStoryPdf: mocks.renderCustomStoryPdf,
}));
vi.mock('../src/services/live-story', () => ({
	hasRowSecurity: mocks.hasRowSecurity,
	refreshStoryData: mocks.refreshStoryData,
	refreshStoryDataForDelivery: mocks.refreshStoryDataForDelivery,
}));
vi.mock('../src/services/notification.service', () => ({
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
vi.mock('../src/services/story-recipients', () => ({
	resolveDeliveryRecipientUserIds: mocks.resolveDeliveryRecipientUserIds,
}));
vi.mock('../src/utils/keyed-lock', () => ({
	withKeyedLock: vi.fn(async (_key: string, callback: () => Promise<void>) => callback()),
}));
vi.mock('../src/utils/logger', () => ({ logger: { error: mocks.logError, info: vi.fn() } }));
vi.mock('../src/utils/story-email', () => ({
	buildStoryEmailHtml: mocks.buildStoryEmailHtml,
	buildStoryPdfAttachment: mocks.buildStoryPdfAttachment,
}));
vi.mock('../src/utils/story-links', () => ({
	storyPath: vi.fn(() => '/stories/story-id'),
}));

import {
	resolveStoryDeliveryProjectId,
	runScheduledStoryDelivery,
	storyDeliveryHandler,
	StoryRecipientDeliveryError,
} from '../src/handlers/story-delivery.handler';
import { NotificationChannelDeliveryError } from '../src/services/notification.service';

beforeEach(() => {
	vi.clearAllMocks();
	mocks.hasRowSecurity.mockResolvedValue(false);
	mocks.resolveDeliveryRecipientUserIds.mockResolvedValue(['recipient-user-id']);
	mocks.refreshStoryData.mockResolvedValue({ queryData: {} });
	mocks.buildStoryEmailHtml.mockResolvedValue(null);
	mocks.buildStoryPdfAttachment.mockResolvedValue([]);
	mocks.renderCustomStoryPdf.mockResolvedValue({ filename: 'story.pdf', buffer: Buffer.from('pdf') });
});

it('delivers the refreshed story with scheduler-verified billing access', async () => {
	await runScheduledStoryDelivery('story-id');

	expect(mocks.refreshStoryData).toHaveBeenCalledWith('chat-id', 'story-slug', {
		billingAccessVerifiedProjectId: 'project-id',
	});
	expect(mocks.notifyUsers).toHaveBeenCalledOnce();
	expect(mocks.notifyUsers).toHaveBeenCalledWith(
		['recipient-user-id'],
		expect.objectContaining({ channels: ['email'] }),
		{ skipDeliveries: [], throwOnChannelError: true },
	);
});

it('renders and sends a separate snapshot with each recipient row-security context', async () => {
	mocks.hasRowSecurity.mockResolvedValue(true);
	mocks.resolveDeliveryRecipientUserIds.mockResolvedValue(['recipient-1', 'recipient-2']);
	mocks.refreshStoryDataForDelivery.mockImplementation(
		async (_chatId: string, _slug: string, options: { viewerUserId: string }) => ({
			queryData: { query_users: { columns: ['viewer'], data: [{ viewer: options.viewerUserId }] } },
			narratives: {},
			code: `code-${options.viewerUserId}`,
		}),
	);

	await runScheduledStoryDelivery('story-id');

	expect(mocks.refreshStoryData).not.toHaveBeenCalled();
	expect(mocks.refreshStoryDataForDelivery).toHaveBeenCalledTimes(2);
	expect(mocks.refreshStoryDataForDelivery).toHaveBeenNthCalledWith(1, 'chat-id', 'story-slug', {
		billingAccessVerifiedProjectId: 'project-id',
		generateViewerCode: true,
		viewerUserId: 'recipient-1',
	});
	expect(mocks.refreshStoryDataForDelivery).toHaveBeenNthCalledWith(2, 'chat-id', 'story-slug', {
		billingAccessVerifiedProjectId: 'project-id',
		generateViewerCode: true,
		viewerUserId: 'recipient-2',
	});
	expect(mocks.buildStoryPdfAttachment).toHaveBeenNthCalledWith(
		1,
		'Story title',
		'code-recipient-1',
		{ query_users: { columns: ['viewer'], data: [{ viewer: 'recipient-1' }] } },
		'project-id',
	);
	expect(mocks.buildStoryPdfAttachment).toHaveBeenNthCalledWith(
		2,
		'Story title',
		'code-recipient-2',
		{ query_users: { columns: ['viewer'], data: [{ viewer: 'recipient-2' }] } },
		'project-id',
	);
	expect(mocks.notifyUsers).toHaveBeenNthCalledWith(
		1,
		['recipient-1'],
		expect.objectContaining({ channels: ['email'] }),
		{ skipDeliveries: [], throwOnChannelError: true },
	);
	expect(mocks.notifyUsers).toHaveBeenNthCalledWith(
		2,
		['recipient-2'],
		expect.objectContaining({ channels: ['email'] }),
		{ skipDeliveries: [], throwOnChannelError: true },
	);
});

it('renders a custom story PDF with the recipient narratives', async () => {
	mocks.hasRowSecurity.mockResolvedValue(true);
	mocks.getStoryById.mockResolvedValueOnce({
		id: 'story-id',
		archivedAt: null,
		chatId: 'chat-id',
		format: 'custom',
		projectId: 'project-id',
		slug: 'story-slug',
		userId: 'user-id',
	} as DBStory);
	mocks.refreshStoryDataForDelivery.mockResolvedValue({
		queryData: { query_users: { columns: ['viewer'], data: [{ viewer: 'recipient-user-id' }] } },
		narratives: { summary: 'Recipient summary' },
		code: 'custom-code',
	});

	await runScheduledStoryDelivery('story-id');

	expect(mocks.renderCustomStoryPdf).toHaveBeenCalledWith(
		'chat-id',
		'story-slug',
		{ query_users: { columns: ['viewer'], data: [{ viewer: 'recipient-user-id' }] } },
		{ summary: 'Recipient summary' },
	);
});

it('continues after a recipient failure and retries only failed recipients', async () => {
	mocks.hasRowSecurity.mockResolvedValue(true);
	mocks.resolveDeliveryRecipientUserIds.mockResolvedValue(['recipient-failed', 'recipient-sent']);
	mocks.refreshStoryDataForDelivery.mockImplementation(
		async (_chatId: string, _slug: string, options: { viewerUserId: string }) => {
			if (options.viewerUserId === 'recipient-failed') {
				throw new Error('Warehouse denied the recipient query.');
			}
			return {
				queryData: { query_users: { columns: ['viewer'], data: [{ viewer: options.viewerUserId }] } },
				narratives: {},
				code: 'recipient-code',
			};
		},
	);

	await expect(storyDeliveryHandler({ storyId: 'story-id' }, { id: 'job-id' } as never)).rejects.toBeInstanceOf(
		StoryRecipientDeliveryError,
	);

	expect(mocks.notifyUsers).toHaveBeenCalledOnce();
	expect(mocks.notifyUsers).toHaveBeenCalledWith(
		['recipient-sent'],
		expect.objectContaining({ channels: ['email'] }),
		{ skipDeliveries: [], throwOnChannelError: true },
	);
	expect(mocks.logError).toHaveBeenCalledWith(
		'Failed to refresh story delivery for recipient: Error: Warehouse denied the recipient query.',
		{
			source: 'system',
			projectId: 'project-id',
			context: {
				storyId: 'story-id',
				recipientUserId: 'recipient-failed',
				stage: 'refresh',
			},
		},
	);
	expect(mocks.updateJobPayload).toHaveBeenCalledWith('job-id', {
		storyId: 'story-id',
		recipientUserIds: ['recipient-failed'],
		skipDeliveries: [{ userId: 'recipient-sent', channel: 'email' }],
	});
});

it('clears recipient retry filters after a successful retry', async () => {
	mocks.hasRowSecurity.mockResolvedValue(true);
	mocks.refreshStoryDataForDelivery.mockResolvedValue({
		queryData: {},
		narratives: {},
		code: 'recipient-code',
	});

	await storyDeliveryHandler({ storyId: 'story-id', recipientUserIds: ['recipient-user-id'], skipDeliveries: [] }, {
		id: 'job-id',
	} as never);

	expect(mocks.updateJobPayload).toHaveBeenCalledWith('job-id', { storyId: 'story-id' });
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
