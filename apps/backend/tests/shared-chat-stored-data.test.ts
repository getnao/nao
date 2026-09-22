import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getChat: vi.fn(),
	getSharedChatInfo: vi.fn(),
	getUserRoleInProject: vi.fn(),
}));

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/chat.queries', () => ({
	getChat: mocks.getChat,
	getChatInfo: vi.fn(),
	getChatOwnerId: vi.fn(),
}));
vi.mock('../src/queries/project.queries', () => ({
	getUserRoleInProject: mocks.getUserRoleInProject,
}));
vi.mock('../src/queries/shared-chat.queries', () => ({
	canUserAccessSharedChat: vi.fn(),
	getSharedChatInfo: mocks.getSharedChatInfo,
}));
vi.mock('../src/queries/story.queries', () => ({}));
vi.mock('../src/services/activity', () => ({ logActivity: vi.fn() }));
vi.mock('../src/services/live-story', () => ({
	getStoryQueryData: vi.fn(),
}));
vi.mock('../src/utils/analytics-event', () => ({ logAnalyticsEvent: vi.fn() }));
vi.mock('../src/utils/email', () => ({ notifySharedItemRecipients: vi.fn() }));
vi.mock('../src/utils/story-download', () => ({ buildDownloadResponse: vi.fn() }));

import { sharedChatRoutes } from '../src/trpc/shared-chat.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router({ sharedChat: sharedChatRoutes });
const chat = {
	id: 'chat-1',
	projectId: 'project-1',
	title: 'Shared chat',
	isStarred: false,
	createdAt: 1,
	updatedAt: 1,
	messages: [],
};

describe('shared chat stored data', () => {
	beforeEach(() => {
		vi.clearAllMocks();
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
		await expect(createCaller().sharedChat.getSharedChat({ shareId: 'share-1' })).resolves.toEqual({
			share: expect.objectContaining({ id: 'share-1', chatId: 'chat-1' }),
			chat,
			userRole: 'user',
		});
		expect(mocks.getChat).toHaveBeenCalledWith('chat-1', { includeFeedback: true });
	});
});

function createCaller() {
	return testRouter.createCaller({
		session: { user: { id: 'viewer-1', name: 'Viewer', email: 'viewer@example.com' } },
	} as never);
}
