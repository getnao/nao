import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createForkedChat: vi.fn(),
	getChatMessages: vi.fn(),
	getStoryByIdForUser: vi.fn(),
	getQueryDataFromCode: vi.fn(),
	getAuthorizedStoredStoryQueryData: vi.fn(),
	assertProjectStoredStoryDataAllowed: vi.fn(),
	getSharedChatInfo: vi.fn(),
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
	getStoryByIdForUser: mocks.getStoryByIdForUser,
}));
vi.mock('../src/queries/story-folder.queries', () => ({}));
vi.mock('../src/services/compaction', () => ({
	compactionService: { useLastCompaction: (messages: unknown[]) => messages },
}));
vi.mock('../src/services/live-story', () => ({
	assertProjectStoredStoryDataAllowed: mocks.assertProjectStoredStoryDataAllowed,
	getAuthorizedStoredStoryQueryData: mocks.getAuthorizedStoredStoryQueryData,
}));
vi.mock('../src/services/user-group-availability.service', () => ({
	resolveAvailableUserGroupAccess: mocks.resolveEffectiveUserGroupAccess,
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
		mocks.getAuthorizedStoredStoryQueryData.mockResolvedValue({});
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
		expect(mocks.getAuthorizedStoredStoryQueryData).not.toHaveBeenCalled();
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
		expect(mocks.getAuthorizedStoredStoryQueryData).toHaveBeenCalledWith('source-chat-id', '# Story', 'user-id');
	});

	it('removes owner stored data from a Story selection fork while keeping authorized data and text', async () => {
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
					{
						type: 'data-compaction',
						data: { summary: 'OWNER_COMPACTION_SECRET query_owner_compaction' },
					},
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
		mocks.getAuthorizedStoredStoryQueryData.mockResolvedValue({
			query_authorized: { columns: ['allowed'], data: [{ allowed: 'AUTHORIZED_VALUE' }] },
		});

		await createCaller().chatFork.fork({
			shareId: 'share-id',
			type: 'story',
			selection: { start: 0, end: 5, text: 'Story' },
		});

		const seededMessages = mocks.createForkedChat.mock.calls[0][1];
		expect(JSON.stringify(seededMessages)).not.toContain('OWNER_SECRET');
		expect(JSON.stringify(seededMessages)).not.toContain('OWNER_PAGED_SECRET');
		expect(JSON.stringify(seededMessages)).not.toContain('OWNER_CHART_SECRET');
		expect(JSON.stringify(seededMessages)).not.toContain('query_owner_chart');
		expect(JSON.stringify(seededMessages)).not.toContain('OWNER_MAP_SECRET');
		expect(JSON.stringify(seededMessages)).not.toContain('query_owner_map');
		expect(JSON.stringify(seededMessages)).not.toContain('OWNER_COMPACTION_SECRET');
		expect(JSON.stringify(seededMessages)).not.toContain('query_owner_compaction');
		expect(JSON.stringify(seededMessages)).not.toContain('OWNER_TEXT_SECRET');
		expect(JSON.stringify(seededMessages)).toContain('AUTHORIZED_VALUE');
		expect(JSON.stringify(seededMessages)).toContain('Useful explanation');
		expect(JSON.stringify(seededMessages)).toContain('Recent question');
	});

	it('propagates denied Story selection data authorization without creating a fork', async () => {
		const denial = new Error('Stored Story data denied.');
		mocks.getAuthorizedStoredStoryQueryData.mockRejectedValueOnce(denial);

		await expect(
			createCaller().chatFork.fork({
				shareId: 'share-id',
				type: 'story',
				selection: { start: 0, end: 5, text: 'Story' },
			}),
		).rejects.toMatchObject({ message: denial.message });
		expect(mocks.getAuthorizedStoredStoryQueryData).toHaveBeenCalledWith('source-chat-id', '# Story', 'user-id');
		expect(mocks.createForkedChat).not.toHaveBeenCalled();
	});

	it('propagates denied full Story fork data authorization without creating a fork', async () => {
		mocks.resolveEffectiveUserGroupAccess.mockResolvedValue({
			features: ['story-creation'],
			toolCallDensityPolicy: { defaultDensity: 'detailed', canChange: true },
		});
		const denial = new Error('Stored Story data denied.');
		mocks.getAuthorizedStoredStoryQueryData.mockRejectedValueOnce(denial);

		await expect(createCaller().chatFork.fork({ shareId: 'share-id', type: 'story' })).rejects.toMatchObject({
			message: denial.message,
		});
		expect(mocks.getAuthorizedStoredStoryQueryData).toHaveBeenCalledWith('source-chat-id', '# Story', 'user-id');
		expect(mocks.createForkedChat).not.toHaveBeenCalled();
	});

	it('authorizes stored data before forking a shared chat', async () => {
		await expect(createCaller().chatFork.fork({ shareId: 'chat-share-id', type: 'chat' })).resolves.toEqual({
			chatId: 'fork-chat-id',
		});
		expect(mocks.assertProjectStoredStoryDataAllowed).toHaveBeenCalledWith('project-id', 'user-id');
	});

	it('propagates denied shared chat data authorization without creating a fork', async () => {
		const denial = new Error('Stored Story data denied.');
		mocks.assertProjectStoredStoryDataAllowed.mockRejectedValueOnce(denial);

		await expect(createCaller().chatFork.fork({ shareId: 'chat-share-id', type: 'chat' })).rejects.toMatchObject({
			message: denial.message,
		});
		expect(mocks.assertProjectStoredStoryDataAllowed).toHaveBeenCalledWith('project-id', 'user-id');
		expect(mocks.getChatMessages).not.toHaveBeenCalled();
		expect(mocks.createForkedChat).not.toHaveBeenCalled();
	});

	it('opens an existing standalone Story without the creation grant', async () => {
		await expect(createCaller().chatFork.openStandalone({ storyId: 'story-id' })).resolves.toEqual({
			chatId: 'existing-chat-id',
		});
		expect(mocks.resolveEffectiveUserGroupAccess).not.toHaveBeenCalled();
		expect(mocks.assertProjectStoredStoryDataAllowed).not.toHaveBeenCalled();
	});

	it('propagates denied standalone stored data authorization without creating a fork', async () => {
		mocks.getStoryByIdForUser.mockResolvedValue({
			id: 'story-id',
			projectId: 'project-id',
			chatId: null,
		});
		const denial = new Error('Stored Story data denied.');
		mocks.assertProjectStoredStoryDataAllowed.mockRejectedValueOnce(denial);

		await expect(createCaller().chatFork.openStandalone({ storyId: 'story-id' })).rejects.toMatchObject({
			message: denial.message,
		});
		expect(mocks.assertProjectStoredStoryDataAllowed).toHaveBeenCalledWith('project-id', 'user-id');
		expect(mocks.createForkedChat).not.toHaveBeenCalled();
	});
});

function createCaller() {
	return testRouter.createCaller({
		session: { user: { id: 'user-id', name: 'Test User', email: 'test@example.com' } },
		selectedProjectId: 'project-id',
	} as never);
}
