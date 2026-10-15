import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EffectiveUserGroupAccess } from '../../src/queries/user-group.queries';
import { createTestCaller } from '../helpers/trpc-caller';

const mocks = vi.hoisted(() => ({
	getSharedStory: vi.fn(),
	getSharedStoryByStoryId: vi.fn(),
	getStoryShareAccess: vi.fn(),
	canUserAccessSharedStory: vi.fn(),
	getUserRoleInProject: vi.fn(),
	getStoryByChatAndSlug: vi.fn(),
	getStoryOwnerId: vi.fn(),
	startStoryRefreshActivity: vi.fn(),
	completeActivity: vi.fn(),
	failActivity: vi.fn(),
	getLatestStoryRefreshFailure: vi.fn(),
	executeLiveQuery: vi.fn(),
	getStoryQueryData: vi.fn(),
	refreshStoryData: vi.fn(),
	assertProjectCloudBillingAccess: vi.fn(),
	logAnalyticsEvent: vi.fn(),
	resolveUserGroupAccess: vi.fn(),
}));

vi.mock('../../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/queries/activity.queries', () => ({
	startStoryRefreshActivity: mocks.startStoryRefreshActivity,
	completeActivity: mocks.completeActivity,
	failActivity: mocks.failActivity,
	getLatestStoryRefreshFailure: mocks.getLatestStoryRefreshFailure,
}));
vi.mock('../../src/queries/chat.queries', () => ({
	getChatInfo: vi.fn(),
}));
vi.mock('../../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-1', orgId: 'org-1', name: 'Project', path: null })),
	getUserRoleInProject: mocks.getUserRoleInProject,
}));
vi.mock('../../src/queries/shared-story.queries', () => ({
	getSharedStory: mocks.getSharedStory,
	getSharedStoryByStoryId: mocks.getSharedStoryByStoryId,
	getStoryShareAccess: mocks.getStoryShareAccess,
	canUserAccessSharedStory: mocks.canUserAccessSharedStory,
}));
vi.mock('../../src/queries/story.queries', () => ({
	getStoryByChatAndSlug: mocks.getStoryByChatAndSlug,
	getStoryOwnerId: mocks.getStoryOwnerId,
}));
vi.mock('../../src/queries/story-folder.queries', () => ({}));
vi.mock('../../src/services/activity', () => ({ logActivity: vi.fn() }));
vi.mock('../../src/services/cloud-billing-access.service', () => ({
	assertOrganizationCloudBillingAccess: vi.fn(),
	assertProjectCloudBillingAccess: mocks.assertProjectCloudBillingAccess,
}));
vi.mock('../../src/services/live-story', () => ({
	executeLiveQuery: mocks.executeLiveQuery,
	getStoryQueryData: mocks.getStoryQueryData,
	refreshStoryData: mocks.refreshStoryData,
}));
vi.mock('../../src/services/shareable-user-groups.service', () => ({
	filterShareableUserGroupIds: vi.fn(async (_projectId: string, groupIds: string[]) => groupIds),
}));
vi.mock('../../src/services/story-filters', () => ({
	assertStoryFiltersEnabled: vi.fn(),
	getFilteredStoryQueryData: vi.fn(),
	getStoryFilterOptions: vi.fn(),
	getStoryQuerySql: vi.fn(),
}));
vi.mock('../../src/services/user-group-availability.service', () => ({
	resolveAvailableUserGroupAccess: mocks.resolveUserGroupAccess,
}));
vi.mock('../../src/utils/analytics-event', () => ({
	logAnalyticsEvent: mocks.logAnalyticsEvent,
}));
vi.mock('../../src/utils/story-download', () => ({ buildDownloadResponse: vi.fn() }));
vi.mock('../../src/utils/story-summary', () => ({ extractStorySummary: vi.fn() }));

import { sharedStoryRoutes } from '../../src/trpc/shared-story.routes';
import { router } from '../../src/trpc/trpc';

const testRouter = router({ storyShare: sharedStoryRoutes });

beforeEach(() => {
	vi.resetAllMocks();
});

describe('storyShare.getSharedStoryInfo', () => {
	const INPUT = { chatId: 'chat-1', storySlug: 'customers' };

	beforeEach(() => {
		mocks.getStoryByChatAndSlug.mockResolvedValue({ id: 'story-1', projectId: 'project-1' });
		mocks.getStoryOwnerId.mockResolvedValue('owner-1');
		mocks.getStoryShareAccess.mockResolvedValue({
			visibility: 'specific',
			allowedUserIds: ['recipient-1'],
			allowedGroupIds: ['group-1'],
		});
	});

	it('hides the access list from a project member who does not own the story', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('user');

		await expect(createCaller('member-1').storyShare.getSharedStoryInfo(INPUT)).resolves.toMatchObject({
			isShared: false,
			allowedUserIds: [],
		});
		expect(mocks.getStoryShareAccess).not.toHaveBeenCalled();
	});

	it('shows the access list to the story owner', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('user');

		await expect(createCaller('owner-1').storyShare.getSharedStoryInfo(INPUT)).resolves.toMatchObject({
			isShared: true,
			allowedUserIds: ['recipient-1'],
		});
	});

	it('shows the access list to a project admin', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('admin');

		await expect(createCaller('admin-1').storyShare.getSharedStoryInfo(INPUT)).resolves.toMatchObject({
			isShared: true,
			allowedGroupIds: ['group-1'],
		});
	});
});

describe('storyShare.getLiveQueryData', () => {
	const STORY_CODE =
		'<chart query_id="q_customers" chart_type="kpi_card" x_axis_key="x" series=\'[{"data_key":"n"}]\' />';

	beforeEach(() => {
		mocks.getSharedStoryByStoryId.mockResolvedValue({
			id: 'share-1',
			projectId: 'project-1',
			userId: 'owner-1',
			visibility: 'specific',
			storyId: 'story-1',
			chatId: 'chat-1',
			slug: 'customers',
			code: STORY_CODE,
		});
		mocks.getUserRoleInProject.mockResolvedValue('user');
		mocks.canUserAccessSharedStory.mockImplementation(
			async (_shareId: string, userId: string) => userId === 'recipient-1',
		);
		mocks.executeLiveQuery.mockResolvedValue({ data: [{ n: 100 }], columns: ['n'] });
	});

	it('runs a query of the shared story for a recipient', async () => {
		await expect(
			createCaller('recipient-1').storyShare.getLiveQueryData({ storyId: 'story-1', queryId: 'q_customers' }),
		).resolves.toEqual({ data: [{ n: 100 }], columns: ['n'] });
		expect(mocks.assertProjectCloudBillingAccess).toHaveBeenCalledWith('project-1');
		expect(mocks.executeLiveQuery).toHaveBeenCalledWith('chat-1', 'q_customers', {
			billingAccessVerifiedProjectId: 'project-1',
		});
	});

	it('refuses a project member the story was not shared with', async () => {
		await expect(
			createCaller('member-1').storyShare.getLiveQueryData({ storyId: 'story-1', queryId: 'q_customers' }),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.executeLiveQuery).not.toHaveBeenCalled();
	});

	it('refuses a query of the chat that the shared story does not use', async () => {
		await expect(
			createCaller('recipient-1').storyShare.getLiveQueryData({ storyId: 'story-1', queryId: 'q_private' }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
		expect(mocks.executeLiveQuery).not.toHaveBeenCalled();
	});
});

describe('shared Story manual refresh', () => {
	const SHARED_ORDERS_STORY = {
		id: 'share-1',
		projectId: 'project-1',
		userId: 'sharer-1',
		visibility: 'project',
		storyId: 'story-1',
		chatId: 'chat-1',
		slug: 'orders',
	};

	beforeEach(() => {
		mocks.getSharedStoryByStoryId.mockResolvedValue(SHARED_ORDERS_STORY);
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
		mocks.resolveUserGroupAccess.mockResolvedValue(createEffectiveUserGroupAccess());
		mocks.getUserRoleInProject.mockImplementation(async (_projectId: string, userId: string) => {
			if (userId === 'admin-1') {
				return 'admin';
			}
			if (userId === 'owner-1' || userId === 'sharer-1' || userId === 'member-1') {
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
		const story = await createCaller(userId).storyShare.get({ storyId: 'story-1' });

		expect(story.canRefresh).toBe(expected);
		expect(mocks.getSharedStoryByStoryId).toHaveBeenCalledWith('story-1');
		expect(mocks.getSharedStory).not.toHaveBeenCalled();
	});

	it.each([
		['owner', 'owner-1', true],
		['member', 'member-1', false],
	] as const)(
		'defers the refresh after a failure only when the %s can retry it',
		async (_label, userId, expected) => {
			mocks.getLatestStoryRefreshFailure.mockResolvedValue({
				errorMessage: 'No output generated.',
				failedAt: new Date('2026-09-12T10:00:00.000Z'),
			});

			await createCaller(userId).storyShare.get({ storyId: 'story-1' });

			expect(mocks.getStoryQueryData).toHaveBeenCalledWith('chat-1', 'orders', undefined, true, null, {
				deferRefresh: expected,
				deferFirstRefresh: expected,
			});
		},
	);

	it.each([
		['owner', 'owner-1', true],
		['member', 'member-1', false],
	] as const)('defers the first refresh only when the %s can run it', async (_label, userId, expected) => {
		await createCaller(userId).storyShare.get({ storyId: 'story-1' });

		expect(mocks.getStoryQueryData).toHaveBeenCalledWith('chat-1', 'orders', undefined, true, null, {
			deferRefresh: false,
			deferFirstRefresh: expected,
		});
	});

	it('leaves the data of a shared custom story to its own endpoints', async () => {
		mocks.getSharedStoryByStoryId.mockResolvedValue({ ...SHARED_ORDERS_STORY, format: 'custom' });

		const story = await createCaller('owner-1').storyShare.get({ storyId: 'story-1' });

		expect(mocks.getStoryQueryData).not.toHaveBeenCalled();
		expect(story).toMatchObject({ queryData: null, needsRefresh: false });
	});

	it('resolves fork permission against the shared Story project', async () => {
		mocks.resolveUserGroupAccess.mockResolvedValue(createEffectiveUserGroupAccess(['storyCreation']));

		const story = await createCaller('member-1', 'selected-project').storyShare.get({ storyId: 'story-1' });

		expect(story.canFork).toBe(true);
		expect(mocks.resolveUserGroupAccess).toHaveBeenCalledWith('project-1', 'member-1');
	});

	it('allows the owner to fork without checking the creation grant', async () => {
		const story = await createCaller('sharer-1', 'selected-project').storyShare.get({ storyId: 'story-1' });

		expect(story.canFork).toBe(true);
		expect(mocks.resolveUserGroupAccess).not.toHaveBeenCalled();
	});

	it('blocks viewers from forking even with the creation grant', async () => {
		mocks.resolveUserGroupAccess.mockResolvedValue(createEffectiveUserGroupAccess(['storyCreation']));

		const story = await createCaller('viewer-1', 'selected-project').storyShare.get({ storyId: 'story-1' });

		expect(story.canFork).toBe(false);
		expect(mocks.resolveUserGroupAccess).not.toHaveBeenCalled();
	});

	it('rejects a viewer before refreshing the shared cache', async () => {
		await expect(createCaller('viewer-1').storyShare.refreshData({ storyId: 'story-1' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});

		expect(mocks.refreshStoryData).not.toHaveBeenCalled();
		expect(mocks.startStoryRefreshActivity).not.toHaveBeenCalled();
	});

	it('rejects refresh when cloud billing access is restricted', async () => {
		mocks.assertProjectCloudBillingAccess.mockRejectedValueOnce(new Error('Cloud billing access is restricted'));

		await expect(createCaller('owner-1').storyShare.refreshData({ storyId: 'story-1' })).rejects.toThrow(
			'Cloud billing access is restricted',
		);

		expect(mocks.assertProjectCloudBillingAccess).toHaveBeenCalledWith('project-1');
		expect(mocks.refreshStoryData).not.toHaveBeenCalled();
		expect(mocks.startStoryRefreshActivity).not.toHaveBeenCalled();
	});

	it('lets the owner refresh using the owner execution principal', async () => {
		await createCaller('owner-1').storyShare.refreshData({ storyId: 'story-1' });

		expect(mocks.assertProjectCloudBillingAccess).toHaveBeenCalledWith('project-1');
		expect(mocks.refreshStoryData).toHaveBeenCalledWith('chat-1', 'orders', {
			billingAccessVerifiedProjectId: 'project-1',
		});
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
		await createCaller('admin-1').storyShare.refreshData({ storyId: 'story-1' });

		expect(mocks.assertProjectCloudBillingAccess).toHaveBeenCalledWith('project-1');
		expect(mocks.refreshStoryData).toHaveBeenCalledWith('chat-1', 'orders', {
			billingAccessVerifiedProjectId: 'project-1',
		});
		expect(mocks.startStoryRefreshActivity).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner-1' }));
		expect(mocks.completeActivity).toHaveBeenCalledWith('activity-1', { queriesRefreshed: 1 });
		expect(mocks.logAnalyticsEvent).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'admin-1' }));
	});

	it('fails the activity and rethrows the original refresh error', async () => {
		const refreshError = new Error('Warehouse unavailable');
		mocks.refreshStoryData.mockRejectedValueOnce(refreshError);

		await expect(createCaller('owner-1').storyShare.refreshData({ storyId: 'story-1' })).rejects.toMatchObject({
			message: 'Warehouse unavailable',
			cause: refreshError,
		});

		expect(mocks.failActivity).toHaveBeenCalledWith('activity-1', 'Warehouse unavailable');
		expect(mocks.completeActivity).not.toHaveBeenCalled();
		expect(mocks.logAnalyticsEvent).not.toHaveBeenCalled();
	});
});

function createCaller(userId: string, selectedProjectId = 'project-1') {
	return createTestCaller(testRouter, { userId, selectedProjectId });
}

function createEffectiveUserGroupAccess(features: EffectiveUserGroupAccess['features'] = []): EffectiveUserGroupAccess {
	return {
		groupNames: ['All Users'],
		features,
		toolCallDensityPolicy: {
			defaultDensity: 'detailed',
			canChange: true,
		},
		databaseAccess: { mode: 'all', strict: false },
		docsAccess: { mode: 'all' },
		rowPolicies: [],
	};
}
