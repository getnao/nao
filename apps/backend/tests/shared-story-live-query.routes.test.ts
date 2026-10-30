import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getSharedStoryByStoryId: vi.fn(),
	canUserAccessSharedStory: vi.fn(),
	getUserRoleInProject: vi.fn(),
	executeLiveQuery: vi.fn(),
	assertOrganizationCloudBillingAccess: vi.fn(),
	assertUserCloudBillingAccess: vi.fn(),
}));

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/activity.queries', () => ({}));
vi.mock('../src/queries/project.queries', () => ({
	getProjectById: vi.fn(async (projectId: string) => ({ id: projectId, orgId: 'org-1' })),
	getUserRoleInProject: mocks.getUserRoleInProject,
}));
vi.mock('../src/queries/shared-story.queries', () => ({
	getSharedStory: vi.fn(),
	getSharedStoryByStoryId: mocks.getSharedStoryByStoryId,
	canUserAccessSharedStory: mocks.canUserAccessSharedStory,
}));
vi.mock('../src/queries/story.queries', () => ({}));
vi.mock('../src/queries/story-folder.queries', () => ({}));
vi.mock('../src/services/activity', () => ({ logActivity: vi.fn() }));
vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertOrganizationCloudBillingAccess: mocks.assertOrganizationCloudBillingAccess,
	assertUserCloudBillingAccess: mocks.assertUserCloudBillingAccess,
	getOrganizationCloudEntitlement: vi.fn(async () => undefined),
	isUserReadOnlyInOrganization: vi.fn(async () => false),
}));
vi.mock('../src/services/live-story', () => ({ executeLiveQuery: mocks.executeLiveQuery }));
vi.mock('../src/utils/analytics-event', () => ({ logAnalyticsEvent: vi.fn() }));

import { sharedStoryRoutes } from '../src/trpc/shared-story.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router({ storyShare: sharedStoryRoutes });
const STORY_CODE =
	'<chart query_id="q_customers" chart_type="kpi_card" x_axis_key="x" series=\'[{"data_key":"n"}]\' />';

describe('storyShare.getLiveQueryData', () => {
	beforeEach(() => {
		vi.clearAllMocks();
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
		expect(mocks.assertOrganizationCloudBillingAccess).toHaveBeenCalledWith('org-1', undefined);
		expect(mocks.assertUserCloudBillingAccess).toHaveBeenCalledWith('org-1', 'recipient-1', undefined);
		expect(mocks.executeLiveQuery).toHaveBeenCalledWith('chat-1', 'q_customers', {
			billingAccessVerifiedProjectId: 'project-1',
			principalUserId: 'recipient-1',
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

function createCaller(userId: string) {
	return testRouter.createCaller({
		session: { user: { id: userId, name: 'Test User', email: `${userId}@example.com` } },
		selectedProjectId: 'project-1',
	} as never);
}
