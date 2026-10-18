import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getUserRoleInProject: vi.fn(),
	getStoryShareAccess: vi.fn(),
}));

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/activity.queries', () => ({}));
vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-1', orgId: 'org-1', name: 'Project', path: null })),
	getUserRoleInProject: mocks.getUserRoleInProject,
}));
vi.mock('../src/queries/shared-story.queries', () => ({
	getSharedStory: vi.fn(),
	getSharedStoryByStoryId: vi.fn(),
	getStoryShareAccess: mocks.getStoryShareAccess,
}));
vi.mock('../src/queries/story.queries', () => ({
	getStoryByChatAndSlug: vi.fn(async () => ({ id: 'story-1', projectId: 'project-1' })),
	getStoryOwnerId: vi.fn(async () => 'owner-1'),
}));
vi.mock('../src/queries/story-folder.queries', () => ({}));
vi.mock('../src/services/activity', () => ({ logActivity: vi.fn() }));
vi.mock('../src/services/shareable-user-groups.service', () => ({
	filterShareableUserGroupIds: vi.fn(async (_projectId: string, groupIds: string[]) => groupIds),
}));
vi.mock('../src/utils/analytics-event', () => ({ logAnalyticsEvent: vi.fn() }));

import { sharedStoryRoutes } from '../src/trpc/shared-story.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router({ storyShare: sharedStoryRoutes });
const INPUT = { chatId: 'chat-1', storySlug: 'customers' };

describe('storyShare.getSharedStoryInfo', () => {
	beforeEach(() => {
		vi.clearAllMocks();
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

function createCaller(userId: string) {
	return testRouter.createCaller({
		session: { user: { id: userId, name: 'Test User', email: `${userId}@example.com` } },
		selectedProjectId: 'project-1',
	} as never);
}
