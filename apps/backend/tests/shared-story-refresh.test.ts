import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getSharedStory: vi.fn(),
	canUserAccessSharedStory: vi.fn(),
	getUserRoleInProject: vi.fn(),
	getStoryByChatAndSlug: vi.fn(),
	getStoryOwnerId: vi.fn(),
	startStoryRefreshActivity: vi.fn(),
	completeActivity: vi.fn(),
	failActivity: vi.fn(),
	getLatestStoryRefreshFailure: vi.fn(),
	getStoryQueryData: vi.fn(),
	refreshStoryData: vi.fn(),
	logAnalyticsEvent: vi.fn(),
}));

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/activity.queries', () => ({
	startStoryRefreshActivity: mocks.startStoryRefreshActivity,
	completeActivity: mocks.completeActivity,
	failActivity: mocks.failActivity,
	getLatestStoryRefreshFailure: mocks.getLatestStoryRefreshFailure,
}));
vi.mock('../src/queries/chat.queries', () => ({
	getChatInfo: vi.fn(),
}));
vi.mock('../src/queries/project.queries', () => ({
	getUserRoleInProject: mocks.getUserRoleInProject,
}));
vi.mock('../src/queries/shared-story.queries', () => ({
	getSharedStory: mocks.getSharedStory,
	canUserAccessSharedStory: mocks.canUserAccessSharedStory,
}));
vi.mock('../src/queries/story.queries', () => ({
	getStoryByChatAndSlug: mocks.getStoryByChatAndSlug,
	getStoryOwnerId: mocks.getStoryOwnerId,
}));
vi.mock('../src/queries/story-folder.queries', () => ({}));
vi.mock('../src/services/activity', () => ({ logActivity: vi.fn() }));
vi.mock('../src/services/live-story', () => ({
	executeLiveQuery: vi.fn(),
	getStoryQueryData: mocks.getStoryQueryData,
	refreshStoryData: mocks.refreshStoryData,
}));
vi.mock('../src/services/story-filters', () => ({
	assertStoryFiltersEnabled: vi.fn(),
	getFilteredStoryQueryData: vi.fn(),
	getStoryFilterOptions: vi.fn(),
	getStoryQuerySql: vi.fn(),
}));
vi.mock('../src/utils/analytics-event', () => ({
	logAnalyticsEvent: mocks.logAnalyticsEvent,
}));
vi.mock('../src/utils/email', () => ({ notifySharedItemRecipients: vi.fn() }));
vi.mock('../src/utils/story-download', () => ({ buildDownloadResponse: vi.fn() }));
vi.mock('../src/utils/story-summary', () => ({ extractStorySummary: vi.fn() }));

import { sharedStoryRoutes } from '../src/trpc/shared-story.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router({ storyShare: sharedStoryRoutes });

describe('shared Story manual refresh', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getSharedStory.mockResolvedValue({
			id: 'share-1',
			projectId: 'project-1',
			userId: 'sharer-1',
			visibility: 'project',
			storyId: 'story-1',
			chatId: 'chat-1',
			slug: 'orders',
		});
		mocks.getStoryByChatAndSlug.mockResolvedValue({
			id: 'story-1',
			chatId: 'chat-1',
			isLive: true,
		});
		mocks.getStoryOwnerId.mockResolvedValue('owner-1');
		mocks.startStoryRefreshActivity.mockResolvedValue({ id: 'activity-1' });
		mocks.getLatestStoryRefreshFailure.mockResolvedValue(null);
		mocks.getStoryQueryData.mockResolvedValue({
			queryData: { query_orders: { columns: ['id'], data: [{ id: 1 }] } },
			cachedAt: new Date('2026-09-12T10:00:00.000Z'),
		});
		mocks.refreshStoryData.mockResolvedValue({
			queryData: { query_orders: { columns: ['id'], data: [{ id: 1 }] } },
		});
		mocks.getUserRoleInProject.mockImplementation(async (_projectId: string, userId: string) => {
			if (userId === 'admin-1') {
				return 'admin';
			}
			if (userId === 'owner-1' || userId === 'member-1') {
				return 'user';
			}
			return 'viewer';
		});
	});

	it.each([
		['owner', 'owner-1', true],
		['admin', 'admin-1', true],
		['member', 'member-1', false],
	] as const)('reports refresh capability for the %s', async (_label, userId, expected) => {
		const story = await createCaller(userId).storyShare.get({ shareId: 'share-1' });

		expect(story.canRefresh).toBe(expected);
	});

	it('rejects a viewer before refreshing the shared cache', async () => {
		await expect(createCaller('viewer-1').storyShare.refreshData({ shareId: 'share-1' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});

		expect(mocks.refreshStoryData).not.toHaveBeenCalled();
		expect(mocks.startStoryRefreshActivity).not.toHaveBeenCalled();
	});

	it('lets the owner refresh using the owner execution principal', async () => {
		await createCaller('owner-1').storyShare.refreshData({ shareId: 'share-1' });

		expect(mocks.refreshStoryData).toHaveBeenCalledWith('chat-1', 'orders', 'owner-1');
		expect(mocks.startStoryRefreshActivity).toHaveBeenCalledWith({
			projectId: 'project-1',
			userId: 'owner-1',
			storyId: 'story-1',
			chatId: 'chat-1',
			trigger: 'manual',
		});
		expect(mocks.completeActivity).toHaveBeenCalledWith('activity-1', { queriesRefreshed: 1 });
		expect(mocks.logAnalyticsEvent).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'owner-1' }));
	});

	it('lets an admin trigger an owner-scoped refresh while recording the admin actor', async () => {
		await createCaller('admin-1').storyShare.refreshData({ shareId: 'share-1' });

		expect(mocks.refreshStoryData).toHaveBeenCalledWith('chat-1', 'orders', 'owner-1');
		expect(mocks.startStoryRefreshActivity).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner-1' }));
		expect(mocks.completeActivity).toHaveBeenCalledWith('activity-1', { queriesRefreshed: 1 });
		expect(mocks.logAnalyticsEvent).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'admin-1' }));
	});

	it('fails the activity and rethrows the original refresh error', async () => {
		const refreshError = new Error('Warehouse unavailable');
		mocks.refreshStoryData.mockRejectedValueOnce(refreshError);

		await expect(createCaller('owner-1').storyShare.refreshData({ shareId: 'share-1' })).rejects.toMatchObject({
			message: 'Warehouse unavailable',
			cause: refreshError,
		});

		expect(mocks.failActivity).toHaveBeenCalledWith('activity-1', 'Warehouse unavailable');
		expect(mocks.completeActivity).not.toHaveBeenCalled();
		expect(mocks.logAnalyticsEvent).not.toHaveBeenCalled();
	});
});

function createCaller(userId: string) {
	return testRouter.createCaller({
		session: { user: { id: userId, name: 'Test User', email: `${userId}@example.com` } },
		selectedProjectId: 'project-1',
	} as never);
}
