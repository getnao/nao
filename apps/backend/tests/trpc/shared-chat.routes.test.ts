import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestCaller } from '../helpers/trpc-caller';

const mocks = vi.hoisted(() => ({
	getChat: vi.fn(),
	getChatInfo: vi.fn(),
	getChatOwnerId: vi.fn(),
	canUserAccessChat: vi.fn(),
	listSharedChatUserGrants: vi.fn(),
	listSharedChatGroupGrants: vi.fn(),
	getUserRoleInProject: vi.fn(),
	listUsersWithProjectAccess: vi.fn(),
	createSharedChat: vi.fn(),
	getSharedChatInfo: vi.fn(),
	getShareIdByChatId: vi.fn(),
	getShareAllowedUserIds: vi.fn(),
	replaceSharedChatAccess: vi.fn(),
	deleteSharedChat: vi.fn(),
	getShareAllowedGroupIds: vi.fn(),
	getSharedChatRecipientUserIds: vi.fn(),
	assertShareableUserGroupIds: vi.fn(),
	notifySharedItem: vi.fn(),
	assertCanShareToProject: vi.fn(),
	assertCanShareWith: vi.fn(),
}));

vi.mock('../../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/queries/chat.queries', () => ({
	getChat: mocks.getChat,
	getChatInfo: mocks.getChatInfo,
	getChatOwnerId: mocks.getChatOwnerId,
	canUserAccessChat: mocks.canUserAccessChat,
}));
vi.mock('../../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-1', name: 'Project' })),
	getUserRoleInProject: mocks.getUserRoleInProject,
	listUsersWithProjectAccess: mocks.listUsersWithProjectAccess,
}));
vi.mock('../../src/queries/shared-chat.queries', () => ({
	canUserAccessSharedChat: vi.fn(),
	createSharedChat: mocks.createSharedChat,
	getSharedChatInfo: mocks.getSharedChatInfo,
	getShareIdByChatId: mocks.getShareIdByChatId,
	getShareAllowedUserIds: mocks.getShareAllowedUserIds,
	replaceSharedChatAccess: mocks.replaceSharedChatAccess,
	deleteSharedChat: mocks.deleteSharedChat,
	getShareAllowedGroupIds: mocks.getShareAllowedGroupIds,
	getSharedChatRecipientUserIds: mocks.getSharedChatRecipientUserIds,
	listSharedChatUserGrants: mocks.listSharedChatUserGrants,
	listSharedChatGroupGrants: mocks.listSharedChatGroupGrants,
}));
vi.mock('../../src/services/shareable-user-groups.service', () => ({
	assertShareableUserGroupIds: mocks.assertShareableUserGroupIds,
}));
vi.mock('../../src/queries/story.queries', () => ({}));
vi.mock('../../src/services/activity', () => ({ logActivity: vi.fn() }));
vi.mock('../../src/services/live-story', () => ({ getStoryQueryData: vi.fn() }));
vi.mock('../../src/services/notification.service', () => ({ notifySharedItem: mocks.notifySharedItem }));
vi.mock('../../src/services/project-sharing.service', () => ({
	assertCanShareToProject: mocks.assertCanShareToProject,
	assertCanShareWith: mocks.assertCanShareWith,
}));
vi.mock('../../src/utils/analytics-event', () => ({ logAnalyticsEvent: vi.fn() }));
vi.mock('../../src/utils/story-download', () => ({ buildDownloadResponse: vi.fn() }));

import { sharedChatRoutes } from '../../src/trpc/shared-chat.routes';
import { router } from '../../src/trpc/trpc';

const testRouter = router({ sharedChat: sharedChatRoutes });

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getUserRoleInProject.mockResolvedValue('user');
	mocks.getChatInfo.mockResolvedValue({ projectId: 'project-1', userId: 'owner-1', title: 'Private chat' });
	mocks.getShareIdByChatId.mockResolvedValue({ id: 'share-1', visibility: 'specific' });
	mocks.createSharedChat.mockResolvedValue({ id: 'share-1' });
	mocks.getShareAllowedUserIds.mockResolvedValue(['member-1']);
	mocks.getShareAllowedGroupIds.mockResolvedValue([]);
	mocks.getSharedChatRecipientUserIds
		.mockReset()
		.mockResolvedValueOnce(['member-1'])
		.mockResolvedValue(['member-1', 'member-2']);
	mocks.listUsersWithProjectAccess.mockResolvedValue([{ id: 'owner-1' }, { id: 'member-1' }, { id: 'member-2' }]);
	mocks.notifySharedItem.mockResolvedValue(undefined);
	mocks.assertCanShareToProject.mockResolvedValue(undefined);
	mocks.assertCanShareWith.mockResolvedValue(undefined);
	mocks.canUserAccessChat.mockResolvedValue(false);
	mocks.listSharedChatUserGrants.mockResolvedValue([
		{ id: 'member-1', name: 'Member', email: 'member-1@example.com' },
	]);
	mocks.listSharedChatGroupGrants.mockResolvedValue([]);
});

describe('sharedChat.getShareSettings', () => {
	it('refuses a member who cannot open the chat', async () => {
		await expect(readSettings('member-2')).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.listSharedChatUserGrants).not.toHaveBeenCalled();
	});

	it('shows who has access to a member the chat is shared with, without letting them manage it', async () => {
		mocks.canUserAccessChat.mockResolvedValue(true);

		const settings = await readSettings('member-1');

		expect(mocks.canUserAccessChat).toHaveBeenCalledWith('chat-1', 'member-1');
		expect(settings).toMatchObject({ canManage: false, users: [{ id: 'member-1' }] });
	});

	it('shows who has access to a project admin', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('admin');

		expect(await readSettings('admin-1')).toMatchObject({ canManage: true, shareId: 'share-1' });
	});
});

describe('sharedChat.saveShareSettings', () => {
	it("refuses a member sharing another member's chat", async () => {
		await expect(save('member-1', { userIds: ['member-2'] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.replaceSharedChatAccess).not.toHaveBeenCalled();
	});

	it("lets a project admin share another member's chat", async () => {
		mocks.getUserRoleInProject.mockResolvedValue('admin');

		await save('admin-1', { userIds: ['member-1', 'member-2'] });

		expect(mocks.replaceSharedChatAccess).toHaveBeenCalledWith('share-1', {
			visibility: 'specific',
			userIds: ['member-1', 'member-2'],
			groupIds: [],
		});
	});

	it('creates the share for the people chosen and notifies the new ones', async () => {
		mocks.getShareIdByChatId.mockResolvedValue(null);
		mocks.getSharedChatRecipientUserIds.mockReset().mockResolvedValueOnce([]).mockResolvedValue(['member-2']);

		await save('owner-1', { userIds: ['member-2'], notify: true });

		expect(mocks.createSharedChat).toHaveBeenCalledWith({ chatId: 'chat-1', visibility: 'specific' });
		expect(mocks.notifySharedItem).toHaveBeenCalledWith(
			expect.objectContaining({ allowedUserIds: ['member-2'], deliverExternally: true }),
		);
	});

	it('shares with the user groups chosen, checking only the new ones', async () => {
		mocks.getShareAllowedGroupIds.mockResolvedValue(['old-group']);

		await save('owner-1', { userIds: ['member-1'], groupIds: ['old-group', 'analysts'] });

		expect(mocks.assertShareableUserGroupIds).toHaveBeenCalledWith('project-1', ['analysts']);
		expect(mocks.replaceSharedChatAccess).toHaveBeenCalledWith('share-1', {
			visibility: 'specific',
			userIds: ['member-1'],
			groupIds: ['old-group', 'analysts'],
		});
	});

	it('keeps the people already on the share without checking them again', async () => {
		await save('owner-1', { userIds: ['member-1', 'member-2'] });

		expect(mocks.assertCanShareWith).toHaveBeenCalledWith('project-1', 'owner-1', {
			userIds: ['member-2'],
			groupIds: [],
		});
	});

	it('returns the share it saved, or none once unshared', async () => {
		await expect(save('owner-1', { userIds: ['member-2'] })).resolves.toEqual({ shareId: 'share-1' });
		await expect(save('owner-1', {})).resolves.toEqual({ shareId: null });
	});

	it('checks recipients against what the owner may share with', async () => {
		mocks.assertCanShareWith.mockRejectedValue(new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed.' }));

		await expect(save('owner-1', { userIds: ['member-2'] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.assertCanShareWith).toHaveBeenCalledWith('project-1', 'owner-1', {
			userIds: ['member-2'],
			groupIds: [],
		});
		expect(mocks.replaceSharedChatAccess).not.toHaveBeenCalled();
	});

	it('leaves out people outside the project and the owner', async () => {
		await save('owner-1', { userIds: ['owner-1', 'outsider-1', 'member-2'] });

		expect(mocks.replaceSharedChatAccess).toHaveBeenCalledWith(
			'share-1',
			expect.objectContaining({ userIds: ['member-2'] }),
		);
	});

	it('unshares the chat when it is limited to nobody', async () => {
		await save('owner-1', {});

		expect(mocks.deleteSharedChat).toHaveBeenCalledWith('share-1');
		expect(mocks.replaceSharedChatAccess).not.toHaveBeenCalled();
	});

	it('refuses to share with the entire project when the user group does not allow it', async () => {
		mocks.assertCanShareToProject.mockRejectedValue(new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed.' }));

		await expect(save('owner-1', { visibility: 'project' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.replaceSharedChatAccess).not.toHaveBeenCalled();
	});

	it('opens the chat to the whole project and notifies it by email only when asked to', async () => {
		await save('owner-1', { visibility: 'project', notify: true });

		expect(mocks.replaceSharedChatAccess).toHaveBeenCalledWith(
			'share-1',
			expect.objectContaining({ visibility: 'project' }),
		);
		expect(mocks.notifySharedItem).toHaveBeenCalledWith(
			expect.objectContaining({ itemId: 'share-1', visibility: 'project', deliverExternally: true }),
		);
	});

	it('does not notify again when the chat is already open to the project', async () => {
		mocks.getShareIdByChatId.mockResolvedValue({ id: 'share-1', visibility: 'project' });

		await save('owner-1', { visibility: 'project', notify: true });

		expect(mocks.notifySharedItem).not.toHaveBeenCalled();
	});
});

describe('sharedChat.getSharedChat', () => {
	const chat = {
		id: 'chat-1',
		projectId: 'project-1',
		title: 'Shared chat',
		isStarred: false,
		createdAt: 1,
		updatedAt: 1,
		messages: [],
	};

	beforeEach(() => {
		mocks.getSharedChatInfo.mockResolvedValue({
			id: 'share-1',
			projectId: 'project-1',
			userId: 'owner-1',
			chatId: 'chat-1',
			visibility: 'project',
			title: 'Shared chat',
			authorName: 'Owner',
		});
		mocks.getChat.mockResolvedValue([chat, 'owner-1']);
	});

	it('returns the shared chat', async () => {
		await expect(createCaller('viewer-1').sharedChat.getSharedChat({ shareId: 'share-1' })).resolves.toEqual({
			share: expect.objectContaining({ id: 'share-1', chatId: 'chat-1' }),
			chat,
			userRole: 'user',
		});
		expect(mocks.getChat).toHaveBeenCalledWith('chat-1', { includeFeedback: true });
	});
});

function save(
	userId: string,
	change: Partial<{ visibility: 'project' | 'specific'; userIds: string[]; groupIds: string[]; notify: boolean }>,
) {
	return createCaller(userId).sharedChat.saveShareSettings({ chatId: 'chat-1', visibility: 'specific', ...change });
}

function readSettings(userId: string) {
	return createCaller(userId).sharedChat.getShareSettings({ chatId: 'chat-1' });
}

function createCaller(userId: string) {
	return createTestCaller(testRouter, { userId, selectedProjectId: 'project-1' });
}
