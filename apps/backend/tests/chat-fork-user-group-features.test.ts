import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createForkedChat: vi.fn(),
	getChatMessages: vi.fn(),
	getStoryByIdForUser: vi.fn(),
	getQueryDataFromCode: vi.fn(),
	getSharedStory: vi.fn(),
	resolveEffectiveUserGroupAccess: vi.fn(),
}));

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/chat.queries', () => ({
	createForkedChat: mocks.createForkedChat,
	getChatMessages: mocks.getChatMessages,
}));
vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', name: 'Project' })),
	getUserRoleInProject: vi.fn(async () => 'user'),
}));
vi.mock('../src/queries/shared-chat.queries', () => ({}));
vi.mock('../src/queries/shared-story.queries', () => ({
	canUserAccessSharedStory: vi.fn(async () => true),
	getQueryDataFromCode: mocks.getQueryDataFromCode,
	getSharedStory: mocks.getSharedStory,
}));
vi.mock('../src/queries/story.queries', () => ({
	getStoryByIdForUser: mocks.getStoryByIdForUser,
}));
vi.mock('../src/queries/story-folder.queries', () => ({}));
vi.mock('../src/services/compaction', () => ({
	compactionService: { useLastCompaction: (messages: unknown[]) => messages },
}));
vi.mock('../src/queries/user-group.queries', () => ({
	resolveEffectiveUserGroupAccess: mocks.resolveEffectiveUserGroupAccess,
}));
vi.mock('../src/services/sso-group-mapping.service', () => ({
	isGroupRoleMappingActive: vi.fn(async () => false),
}));

import { chatForkRoutes } from '../src/trpc/chat-fork.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router({ chatFork: chatForkRoutes });

describe('chat fork Story creation permission', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.resolveEffectiveUserGroupAccess.mockResolvedValue({
			features: [],
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: true,
			},
		});
		mocks.getSharedStory.mockResolvedValue({
			id: 'share-id',
			projectId: 'project-id',
			storyId: 'story-id',
			chatId: 'source-chat-id',
			slug: 'story',
			title: 'Story',
			code: '# Story',
			version: 1,
			visibility: 'project',
			userId: 'owner-id',
			authorName: 'Owner',
		});
		mocks.getChatMessages.mockResolvedValue([]);
		mocks.getQueryDataFromCode.mockResolvedValue({});
		mocks.createForkedChat.mockResolvedValue({ id: 'fork-chat-id' });
		mocks.getStoryByIdForUser.mockResolvedValue({
			id: 'story-id',
			projectId: 'project-id',
			chatId: 'existing-chat-id',
		});
	});

	it('denies a full shared Story fork that would create a Story', async () => {
		await expect(createCaller().chatFork.fork({ shareId: 'share-id', type: 'story' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Story creation is not enabled for your user group.',
		});
		expect(mocks.createForkedChat).not.toHaveBeenCalled();
	});

	it('allows a shared Story selection fork without the creation grant', async () => {
		await expect(
			createCaller().chatFork.fork({
				shareId: 'share-id',
				type: 'story',
				selection: { start: 0, end: 5, text: 'Story' },
			}),
		).resolves.toEqual({ chatId: 'fork-chat-id' });
		expect(mocks.resolveEffectiveUserGroupAccess).not.toHaveBeenCalled();
	});

	it('opens an existing standalone Story without the creation grant', async () => {
		await expect(createCaller().chatFork.openStandalone({ storyId: 'story-id' })).resolves.toEqual({
			chatId: 'existing-chat-id',
		});
		expect(mocks.resolveEffectiveUserGroupAccess).not.toHaveBeenCalled();
	});
});

function createCaller() {
	return testRouter.createCaller({
		session: { user: { id: 'user-id', name: 'Test User', email: 'test@example.com' } },
		selectedProjectId: 'project-id',
	} as never);
}
