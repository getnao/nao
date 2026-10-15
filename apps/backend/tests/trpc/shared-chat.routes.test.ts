import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestCaller } from '../helpers/trpc-caller';

const mocks = vi.hoisted(() => ({
	createSharedChat: vi.fn(),
	getChat: vi.fn(),
	getChatInfo: vi.fn(),
	getSharedChatInfo: vi.fn(),
	getUserRoleInProject: vi.fn(),
	notifySharedItem: vi.fn(),
}));

vi.mock('../../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/queries/chat.queries', () => ({
	getChat: mocks.getChat,
	getChatInfo: mocks.getChatInfo,
	getChatOwnerId: vi.fn(),
}));
vi.mock('../../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-1', name: 'Project' })),
	getUserRoleInProject: mocks.getUserRoleInProject,
}));
vi.mock('../../src/queries/shared-chat.queries', () => ({
	canUserAccessSharedChat: vi.fn(),
	createSharedChat: mocks.createSharedChat,
	getSharedChatInfo: mocks.getSharedChatInfo,
}));
vi.mock('../../src/queries/story.queries', () => ({}));
vi.mock('../../src/queries/user.queries', () => ({}));
vi.mock('../../src/services/activity', () => ({ logActivity: vi.fn() }));
vi.mock('../../src/services/live-story', () => ({ getStoryQueryData: vi.fn() }));
vi.mock('../../src/services/notification.service', () => ({ notifySharedItem: mocks.notifySharedItem }));
vi.mock('../../src/utils/analytics-event', () => ({ logAnalyticsEvent: vi.fn() }));
vi.mock('../../src/utils/story-download', () => ({ buildDownloadResponse: vi.fn() }));

import { sharedChatRoutes } from '../../src/trpc/shared-chat.routes';
import { router } from '../../src/trpc/trpc';

const testRouter = router({ sharedChat: sharedChatRoutes });

beforeEach(() => {
	vi.clearAllMocks();
});

describe('sharedChat.create', () => {
	beforeEach(() => {
		mocks.getChatInfo.mockResolvedValue({ projectId: 'project-1', userId: 'owner-1', title: 'Private chat' });
		mocks.createSharedChat.mockResolvedValue({ id: 'share-1' });
		mocks.notifySharedItem.mockResolvedValue(undefined);
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
		mocks.getUserRoleInProject.mockResolvedValue('user');
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

function createCaller(userId: string) {
	return createTestCaller(testRouter, { userId, selectedProjectId: 'project-1' });
}
