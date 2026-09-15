import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	class StoredStoryDataAccessDeniedError extends Error {}
	return {
		assertProjectStoredStoryDataAllowed: vi.fn(),
		getChat: vi.fn(),
		getSharedChatInfo: vi.fn(),
		getUserRoleInProject: vi.fn(),
		StoredStoryDataAccessDeniedError,
	};
});

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
	assertProjectStoredStoryDataAllowed: mocks.assertProjectStoredStoryDataAllowed,
	getStoryQueryData: vi.fn(),
	StoredStoryDataAccessDeniedError: mocks.StoredStoryDataAccessDeniedError,
}));
vi.mock('../src/utils/analytics-event', () => ({ logAnalyticsEvent: vi.fn() }));
vi.mock('../src/utils/email', () => ({ notifySharedItemRecipients: vi.fn() }));
vi.mock('../src/utils/story-download', () => ({ buildDownloadResponse: vi.fn() }));

import { sharedChatRoutes } from '../src/trpc/shared-chat.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router({ sharedChat: sharedChatRoutes });

describe('shared chat stored data authorization', () => {
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
	});

	it('returns FORBIDDEN and does not load chat data when stored data is denied', async () => {
		mocks.assertProjectStoredStoryDataAllowed.mockRejectedValue(
			new mocks.StoredStoryDataAccessDeniedError(
				'Stored Story data cannot be safely resolved for this principal.',
			),
		);

		await expect(createCaller().sharedChat.getSharedChat({ shareId: 'share-1' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Stored Story data cannot be safely resolved for this principal.',
		});
		expect(mocks.assertProjectStoredStoryDataAllowed).toHaveBeenCalledWith('project-1', 'viewer-1');
		expect(mocks.getChat).not.toHaveBeenCalled();
	});
});

function createCaller() {
	return testRouter.createCaller({
		session: { user: { id: 'viewer-1', name: 'Viewer', email: 'viewer@example.com' } },
	} as never);
}
