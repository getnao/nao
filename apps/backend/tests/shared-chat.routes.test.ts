import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getChatInfo: vi.fn(),
	getChatOwnerId: vi.fn(),
	getUserRoleInProject: vi.fn(),
	listUsersWithProjectAccess: vi.fn(),
	createSharedChat: vi.fn(),
	getSharedChatInfo: vi.fn(),
	getShareAllowedUserIds: vi.fn(),
	updateSharedChatAllowedUsers: vi.fn(),
	notifySharedItem: vi.fn(),
	assertCanShareToProject: vi.fn(),
	assertCanShareWith: vi.fn(),
}));

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/chat.queries', () => ({
	getChatInfo: mocks.getChatInfo,
	getChatOwnerId: mocks.getChatOwnerId,
}));
vi.mock('../src/queries/project.queries', () => ({
	getProjectById: vi.fn(async () => null),
	getProjectByUserId: vi.fn(async () => ({ id: 'project-1', name: 'Project' })),
	getUserRoleInProject: mocks.getUserRoleInProject,
	listUsersWithProjectAccess: mocks.listUsersWithProjectAccess,
}));
vi.mock('../src/queries/shared-chat.queries', () => ({
	createSharedChat: mocks.createSharedChat,
	getSharedChatInfo: mocks.getSharedChatInfo,
	getShareAllowedUserIds: mocks.getShareAllowedUserIds,
	updateSharedChatAllowedUsers: mocks.updateSharedChatAllowedUsers,
}));
vi.mock('../src/queries/story.queries', () => ({}));
vi.mock('../src/queries/user.queries', () => ({}));
vi.mock('../src/services/activity', () => ({ logActivity: vi.fn() }));
vi.mock('../src/services/live-story', () => ({}));
vi.mock('../src/services/notification.service', () => ({ notifySharedItem: mocks.notifySharedItem }));
vi.mock('../src/services/project-sharing.service', () => ({
	assertCanShareToProject: mocks.assertCanShareToProject,
	assertCanShareWith: mocks.assertCanShareWith,
}));
vi.mock('../src/utils/analytics-event', () => ({}));
vi.mock('../src/utils/story-download', () => ({}));

import { sharedChatRoutes } from '../src/trpc/shared-chat.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router({ sharedChat: sharedChatRoutes });

describe('sharedChat.create', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getChatInfo.mockResolvedValue({ projectId: 'project-1', userId: 'owner-1', title: 'Private chat' });
		mocks.createSharedChat.mockResolvedValue({ id: 'share-1' });
		mocks.notifySharedItem.mockResolvedValue(undefined);
		mocks.assertCanShareToProject.mockResolvedValue(undefined);
		mocks.assertCanShareWith.mockResolvedValue(undefined);
	});

	it("refuses a member sharing another member's chat", async () => {
		mocks.getUserRoleInProject.mockResolvedValue('user');

		await expect(createCaller('member-1').sharedChat.create({ chatId: 'chat-1' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(mocks.createSharedChat).not.toHaveBeenCalled();
	});

	it('lets the owner share their chat', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('user');

		await expect(createCaller('owner-1').sharedChat.create({ chatId: 'chat-1' })).resolves.toEqual({
			id: 'share-1',
		});
	});

	it("lets a project admin share another member's chat", async () => {
		mocks.getUserRoleInProject.mockResolvedValue('admin');

		await expect(createCaller('admin-1').sharedChat.create({ chatId: 'chat-1' })).resolves.toEqual({
			id: 'share-1',
		});
	});

	it('refuses to share with the entire project when the user group does not allow it', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('user');
		mocks.assertCanShareToProject.mockRejectedValue(new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed.' }));

		await expect(
			createCaller('owner-1').sharedChat.create({ chatId: 'chat-1', visibility: 'project' }),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.assertCanShareToProject).toHaveBeenCalledWith('project-1', 'owner-1');
		expect(mocks.createSharedChat).not.toHaveBeenCalled();
	});

	it('checks specific recipients against what the owner may share with', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('user');
		mocks.assertCanShareWith.mockRejectedValue(new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed.' }));

		await expect(
			createCaller('owner-1').sharedChat.create({
				chatId: 'chat-1',
				visibility: 'specific',
				allowedUserIds: ['outsider-1'],
			}),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.assertCanShareWith).toHaveBeenCalledWith('project-1', 'owner-1', { userIds: ['outsider-1'] });
		expect(mocks.assertCanShareToProject).not.toHaveBeenCalled();
		expect(mocks.createSharedChat).not.toHaveBeenCalled();
	});
});

describe('sharedChat.updateAccess', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getUserRoleInProject.mockResolvedValue('user');
		mocks.getSharedChatInfo.mockResolvedValue({
			id: 'share-1',
			chatId: 'chat-1',
			projectId: 'project-1',
			visibility: 'specific',
			title: 'Chat',
		});
		mocks.getChatOwnerId.mockResolvedValue('owner-1');
		mocks.getShareAllowedUserIds.mockResolvedValue(['member-1', 'member-2']);
		mocks.listUsersWithProjectAccess.mockResolvedValue([{ id: 'member-1' }, { id: 'member-2' }]);
		mocks.assertCanShareWith.mockResolvedValue(undefined);
		mocks.notifySharedItem.mockResolvedValue(undefined);
	});

	it('refuses to add a recipient the owner may not share with', async () => {
		mocks.assertCanShareWith.mockRejectedValue(new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed.' }));

		await expect(
			createCaller('owner-1').sharedChat.updateAccess({
				shareId: 'share-1',
				allowedUserIds: ['member-1', 'outsider-1'],
			}),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.assertCanShareWith).toHaveBeenCalledWith('project-1', 'owner-1', { userIds: ['outsider-1'] });
		expect(mocks.updateSharedChatAllowedUsers).not.toHaveBeenCalled();
	});

	it('only checks newly added recipients, so removing people is always allowed', async () => {
		await createCaller('owner-1').sharedChat.updateAccess({ shareId: 'share-1', allowedUserIds: ['member-1'] });

		expect(mocks.assertCanShareWith).toHaveBeenCalledWith('project-1', 'owner-1', { userIds: [] });
		expect(mocks.updateSharedChatAllowedUsers).toHaveBeenCalledWith('share-1', ['member-1']);
	});
});

function createCaller(userId: string) {
	return testRouter.createCaller({
		session: { user: { id: userId, name: 'Caller', email: `${userId}@example.com` } },
		selectedProjectId: 'project-1',
	} as never);
}
