import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createForkedChat: vi.fn(),
	createStoryVersion: vi.fn(),
	getChatMessages: vi.fn(),
	getStoryByIdForUser: vi.fn(),
	getQueryDataFromCode: vi.fn(),
	getSharedChatInfo: vi.fn(),
	getSharedStory: vi.fn(),
	resolveUserGroupAccess: vi.fn(),
	saveStoryInPrivateRoot: vi.fn(),
	upsertMessage: vi.fn(),
}));

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/chat.queries', () => ({
	createForkedChat: mocks.createForkedChat,
	getChatMessages: mocks.getChatMessages,
	upsertMessage: mocks.upsertMessage,
}));
vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', name: 'Project' })),
	getUserRoleInProject: vi.fn(async () => 'user'),
}));
vi.mock('../src/queries/shared-chat.queries', () => ({
	canUserAccessSharedChat: vi.fn(async () => true),
	getSharedChatInfo: mocks.getSharedChatInfo,
}));
vi.mock('../src/queries/shared-story.queries', () => ({
	canUserAccessSharedStory: vi.fn(async () => true),
	getQueryDataFromCode: mocks.getQueryDataFromCode,
	getSharedStory: mocks.getSharedStory,
}));
vi.mock('../src/queries/story.queries', () => ({
	createStoryVersion: mocks.createStoryVersion,
	getStoryByIdForUser: mocks.getStoryByIdForUser,
}));
vi.mock('../src/queries/story-folder.queries', () => ({
	saveStoryInPrivateRoot: mocks.saveStoryInPrivateRoot,
}));
vi.mock('../src/services/compaction', () => ({
	compactionService: { useLastCompaction: (messages: unknown[]) => messages },
}));
vi.mock('../src/services/user-group-availability.service', () => ({
	resolveAvailableUserGroupAccess: mocks.resolveUserGroupAccess,
}));
vi.mock('../src/services/sso-group-mapping.service', () => ({
	isOrganizationRoleMappingActive: vi.fn(async () => false),
}));

import { chatForkRoutes } from '../src/trpc/chat-fork.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router({ chatFork: chatForkRoutes });

describe('chat fork Story creation permission', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.resolveUserGroupAccess.mockResolvedValue({
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
		mocks.getSharedChatInfo.mockResolvedValue({
			id: 'chat-share-id',
			projectId: 'project-id',
			chatId: 'source-chat-id',
			title: 'Shared chat',
			visibility: 'project',
			userId: 'owner-id',
			authorName: 'Owner',
		});
		mocks.getChatMessages.mockResolvedValue([]);
		mocks.getQueryDataFromCode.mockResolvedValue({});
		mocks.createForkedChat.mockResolvedValue({ id: 'fork-chat-id' });
		mocks.createStoryVersion.mockResolvedValue({ storyId: 'fork-story-id', version: 1 });
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
		expect(mocks.getQueryDataFromCode).not.toHaveBeenCalled();
	});

	it('denies a shared Story selection fork without the creation grant', async () => {
		await expect(
			createCaller().chatFork.fork({
				shareId: 'share-id',
				type: 'story',
				selection: { start: 0, end: 5, text: 'Story' },
			}),
		).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Story creation is not enabled for your user group.',
		});
		expect(mocks.createForkedChat).not.toHaveBeenCalled();
		expect(mocks.getQueryDataFromCode).not.toHaveBeenCalled();
	});

	it('allows the Story owner to create a selection fork without checking the creation grant', async () => {
		await expect(
			createCaller('owner-id').chatFork.fork({
				shareId: 'share-id',
				type: 'story',
				selection: { start: 0, end: 5, text: 'Story' },
			}),
		).resolves.toEqual({ chatId: 'fork-chat-id' });
		expect(mocks.resolveUserGroupAccess).not.toHaveBeenCalled();
		expect(mocks.getQueryDataFromCode).toHaveBeenCalledWith('source-chat-id', '# Story');
	});

	it('allows the Story owner to create a full fork without checking the creation grant', async () => {
		await expect(createCaller('owner-id').chatFork.fork({ shareId: 'share-id', type: 'story' })).resolves.toEqual({
			chatId: 'fork-chat-id',
		});
		expect(mocks.resolveUserGroupAccess).not.toHaveBeenCalled();
		expect(mocks.createStoryVersion).toHaveBeenCalled();
	});

	it('allows a full shared Story fork with the creation grant', async () => {
		mocks.resolveUserGroupAccess.mockResolvedValue({
			features: ['storyCreation'],
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: true,
			},
		});

		await expect(createCaller().chatFork.fork({ shareId: 'share-id', type: 'story' })).resolves.toEqual({
			chatId: 'fork-chat-id',
		});
		expect(mocks.resolveUserGroupAccess).toHaveBeenCalledWith('project-id', 'user-id');
		expect(mocks.createStoryVersion).toHaveBeenCalled();
	});

	it('seeds a Story selection fork with the original tool outputs unchanged', async () => {
		mocks.resolveUserGroupAccess.mockResolvedValue({
			features: ['storyCreation'],
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: true,
			},
		});
		mocks.getChatMessages.mockResolvedValue([
			{
				id: 'message-before-compaction',
				role: 'assistant',
				parts: [{ type: 'text', text: 'OWNER_TEXT_SECRET' }],
			},
			{
				id: 'message-compaction',
				role: 'assistant',
				parts: [
					{ type: 'text', text: 'SAME_MESSAGE_OWNER_SECRET' },
					{
						type: 'data-compaction',
						data: { summary: 'OWNER_COMPACTION_SECRET query_owner_compaction' },
					},
					{ type: 'text', text: 'Safe explanation after compaction' },
				],
			},
			{
				id: 'message-1',
				role: 'assistant',
				parts: [
					{ type: 'text', text: 'Useful explanation' },
					{
						type: 'tool-execute_sql',
						toolName: 'execute_sql',
						toolCallId: 'owner-query',
						state: 'output-available',
						input: { sql_query: 'select secret' },
						output: {
							id: 'query_owner',
							columns: ['secret'],
							data: [{ secret: 'OWNER_SECRET' }],
						},
					},
					{
						type: 'dynamic-tool',
						toolName: 'read_query_result',
						toolCallId: 'owner-query-page',
						state: 'output-available',
						input: { query_id: 'query_owner' },
						output: { data: [{ secret: 'OWNER_PAGED_SECRET' }] },
					},
					{
						type: 'tool-display_chart',
						toolName: 'display_chart',
						toolCallId: 'owner-chart',
						state: 'output-available',
						input: { query_id: 'query_owner_chart' },
						output: { title: 'OWNER_CHART_SECRET' },
					},
					{
						type: 'tool-display_map',
						toolName: 'display_map',
						toolCallId: 'owner-map',
						state: 'output-available',
						input: { query_id: 'query_owner_map' },
						output: { title: 'OWNER_MAP_SECRET' },
					},
				],
			},
			{ id: 'message-2', role: 'user', parts: [{ type: 'text', text: 'Recent question' }] },
		]);
		mocks.getQueryDataFromCode.mockResolvedValue({
			query_shared: { columns: ['allowed'], data: [{ allowed: 'SHARED_VALUE' }] },
		});

		await createCaller().chatFork.fork({
			shareId: 'share-id',
			type: 'story',
			selection: { start: 0, end: 5, text: 'Story' },
		});

		const seededMessages = mocks.createForkedChat.mock.calls[0][1];
		expect(JSON.stringify(seededMessages)).toContain('OWNER_SECRET');
		expect(JSON.stringify(seededMessages)).toContain('OWNER_PAGED_SECRET');
		expect(JSON.stringify(seededMessages)).toContain('OWNER_CHART_SECRET');
		expect(JSON.stringify(seededMessages)).toContain('OWNER_MAP_SECRET');
		expect(JSON.stringify(seededMessages)).toContain('OWNER_COMPACTION_SECRET');
		expect(JSON.stringify(seededMessages)).toContain('OWNER_TEXT_SECRET');
		expect(JSON.stringify(seededMessages)).toContain('SAME_MESSAGE_OWNER_SECRET');
		expect(JSON.stringify(seededMessages)).toContain('SHARED_VALUE');
		expect(JSON.stringify(seededMessages)).toContain('Safe explanation after compaction');
		expect(JSON.stringify(seededMessages)).toContain('Useful explanation');
		expect(JSON.stringify(seededMessages)).toContain('Recent question');
	});

	it('forks a shared chat with its stored tool outputs', async () => {
		await expect(createCaller().chatFork.fork({ shareId: 'chat-share-id', type: 'chat' })).resolves.toEqual({
			chatId: 'fork-chat-id',
		});
		expect(mocks.getChatMessages).toHaveBeenCalledWith('source-chat-id');
	});

	it('opens an existing standalone Story without the creation grant', async () => {
		await expect(createCaller().chatFork.openStandalone({ storyId: 'story-id' })).resolves.toEqual({
			chatId: 'existing-chat-id',
		});
		expect(mocks.resolveUserGroupAccess).not.toHaveBeenCalled();
	});
});

function createCaller(userId = 'user-id') {
	return testRouter.createCaller({
		session: { user: { id: userId, name: 'Test User', email: 'test@example.com' } },
		selectedProjectId: 'project-id',
	} as never);
}
