import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertProjectCloudBillingAccess: vi.fn(),
	assignChatToStory: vi.fn(),
	createCustomStory: vi.fn(),
	createForkedChat: vi.fn(),
	deleteChat: vi.fn(),
	createStoryVersion: vi.fn(),
	getChatMessages: vi.fn(),
	getLatestSqlQueryDataByIds: vi.fn(),
	getLatestVersionByStoryId: vi.fn(),
	getReferenceableStory: vi.fn(),
	getStoryByIdForUser: vi.fn(),
	getStoryDataCacheByStoryId: vi.fn(),
	getStoryProjectId: vi.fn(),
	getQueryDataFromCode: vi.fn(),
	getSharedChatInfo: vi.fn(),
	getSharedStoryByStoryId: vi.fn(),
	listVersionFiles: vi.fn(),
	publishCustomStoryDraft: vi.fn(),
	resolveUserGroupAccess: vi.fn(),
	saveStoryInPrivateRoot: vi.fn(),
	seedDraftFiles: vi.fn(),
	upsertMessage: vi.fn(),
}));

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/chat.queries', () => ({
	createForkedChat: mocks.createForkedChat,
	deleteChat: mocks.deleteChat,
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
	getSharedStoryByStoryId: mocks.getSharedStoryByStoryId,
}));
vi.mock('../src/queries/story.queries', () => ({
	assignChatToStory: mocks.assignChatToStory,
	createCustomStory: mocks.createCustomStory,
	createStoryVersion: mocks.createStoryVersion,
	getLatestVersionByStoryId: mocks.getLatestVersionByStoryId,
	getStoryByIdForUser: mocks.getStoryByIdForUser,
	getStoryDataCacheByStoryId: mocks.getStoryDataCacheByStoryId,
	getStoryProjectId: mocks.getStoryProjectId,
}));
vi.mock('../src/queries/story-folder.queries', () => ({
	saveStoryInPrivateRoot: mocks.saveStoryInPrivateRoot,
}));
vi.mock('../src/queries/story-reference.queries', () => ({
	getReferenceableStory: mocks.getReferenceableStory,
}));
vi.mock('../src/queries/story-file.queries', () => ({
	listVersionFiles: mocks.listVersionFiles,
	seedDraftFiles: mocks.seedDraftFiles,
}));
vi.mock('../src/queries/execute-sql.queries', () => ({
	getLatestSqlQueryDataByIds: mocks.getLatestSqlQueryDataByIds,
}));
vi.mock('../src/services/custom-story-authoring', () => ({
	publishCustomStoryDraft: mocks.publishCustomStoryDraft,
}));
vi.mock('../src/services/compaction', () => ({
	compactionService: { useLastCompaction: (messages: unknown[]) => messages },
}));
vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: mocks.assertProjectCloudBillingAccess,
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
		mocks.getSharedStoryByStoryId.mockResolvedValue({
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
		await expect(
			createCaller().chatFork.fork({ source: { type: 'story', storyId: 'story-id' } }),
		).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Story creation is not enabled for your user group.',
		});
		expect(mocks.createForkedChat).not.toHaveBeenCalled();
		expect(mocks.getQueryDataFromCode).not.toHaveBeenCalled();
	});

	it('denies a shared Story selection fork without the creation grant', async () => {
		await expect(
			createCaller().chatFork.fork({
				source: { type: 'story', storyId: 'story-id' },
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
				source: { type: 'story', storyId: 'story-id' },
				selection: { start: 0, end: 5, text: 'Story' },
			}),
		).resolves.toEqual({ chatId: 'fork-chat-id' });
		expect(mocks.getSharedStoryByStoryId).toHaveBeenCalledTimes(1);
		expect(mocks.resolveUserGroupAccess).not.toHaveBeenCalled();
		expect(mocks.getQueryDataFromCode).toHaveBeenCalledWith('source-chat-id', '# Story');
		expect(mocks.createForkedChat.mock.calls[0][0].forkMetadata.id).toBe('story-id');
	});

	it('allows the Story owner to create a full fork without checking the creation grant', async () => {
		await expect(
			createCaller('owner-id').chatFork.fork({ source: { type: 'story', storyId: 'story-id' } }),
		).resolves.toEqual({
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

		await expect(createCaller().chatFork.fork({ source: { type: 'story', storyId: 'story-id' } })).resolves.toEqual(
			{
				chatId: 'fork-chat-id',
			},
		);
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
			source: { type: 'story', storyId: 'story-id' },
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
		await expect(
			createCaller().chatFork.fork({ source: { type: 'chat', shareId: 'chat-share-id' } }),
		).resolves.toEqual({
			chatId: 'fork-chat-id',
		});
		expect(mocks.getSharedChatInfo).toHaveBeenCalledTimes(1);
		expect(mocks.getChatMessages).toHaveBeenCalledWith('source-chat-id');
	});

	it('asks a quick question about a shared chat as a fork tied to the share', async () => {
		await expect(
			createCaller().chatFork.askSharedChat({
				shareId: 'chat-share-id',
				selection: { start: 4, end: 18, text: 'Revenue dipped' },
			}),
		).resolves.toEqual({ chatId: 'fork-chat-id' });

		const [{ forkMetadata }, seededMessages] = mocks.createForkedChat.mock.calls[0];
		expect(forkMetadata).toMatchObject({
			type: 'chat_question',
			id: 'chat-share-id',
			selectionText: 'Revenue dipped',
		});
		expect(JSON.stringify(seededMessages)).toContain('Revenue dipped');
	});

	it('opens an existing standalone Story without the creation grant', async () => {
		await expect(createCaller().chatFork.openStandalone({ storyId: 'story-id' })).resolves.toEqual({
			chatId: 'existing-chat-id',
		});
		expect(mocks.resolveUserGroupAccess).not.toHaveBeenCalled();
	});
});

describe('fork of any accessible Story', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.resolveUserGroupAccess.mockResolvedValue({
			features: [],
			toolCallDensityPolicy: { defaultDensity: 'detailed', canChange: true },
		});
		mocks.createForkedChat.mockResolvedValue({ id: 'fork-chat-id' });
		mocks.createStoryVersion.mockResolvedValue({ storyId: 'fork-story-id', version: 1 });
		mocks.getLatestSqlQueryDataByIds.mockResolvedValue({});
		mocks.getReferenceableStory.mockResolvedValue(createReferenceableStory({}));
		mocks.getStoryProjectId.mockResolvedValue('project-id');
	});

	it('opens a quick question on a Story as an empty chat, without the story creation grant', async () => {
		await expect(
			createCaller().chatFork.askStory({ storyId: 'story-id', selectionText: 'Revenue dipped in May' }),
		).resolves.toEqual({ chatId: 'fork-chat-id', hasAttachedStoryChat: false });

		expect(mocks.resolveUserGroupAccess).not.toHaveBeenCalled();
		expect(mocks.createForkedChat).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: 'project-id',
				userId: 'user-id',
				forkMetadata: {
					type: 'story_question',
					id: 'story-id',
					title: 'Story',
					authorName: 'Owner',
					selectionText: 'Revenue dipped in May',
				},
			}),
			[],
		);
		expect(mocks.createStoryVersion).not.toHaveBeenCalled();
	});

	it('gives a standalone Story of the user a chat first, so the quick question can edit it', async () => {
		mocks.getReferenceableStory.mockResolvedValue(createReferenceableStory({ chatId: null, ownerId: 'user-id' }));
		mocks.createForkedChat
			.mockResolvedValueOnce({ id: 'story-chat-id' })
			.mockResolvedValueOnce({ id: 'question-id' });

		await expect(createCaller().chatFork.askStory({ storyId: 'story-id' })).resolves.toEqual({
			chatId: 'question-id',
			hasAttachedStoryChat: true,
		});

		expect(mocks.assignChatToStory).toHaveBeenCalledWith('story-id', 'story-chat-id');
		expect(mocks.createForkedChat).toHaveBeenLastCalledWith(
			expect.objectContaining({ forkMetadata: expect.objectContaining({ type: 'story_question' }) }),
			[],
		);
	});

	it('leaves the standalone Story of someone else without a chat', async () => {
		mocks.getReferenceableStory.mockResolvedValue(createReferenceableStory({ chatId: null }));

		await expect(createCaller().chatFork.askStory({ storyId: 'story-id' })).resolves.toEqual({
			chatId: 'fork-chat-id',
			hasAttachedStoryChat: false,
		});
		expect(mocks.assignChatToStory).not.toHaveBeenCalled();
	});

	it('forks the Story in its own project, whatever project is active', async () => {
		mocks.getStoryProjectId.mockResolvedValue('other-project-id');

		await createCaller('owner-id').chatFork.forkStory({ storyId: 'story-id' });

		expect(mocks.getReferenceableStory).toHaveBeenCalledWith('owner-id', 'other-project-id', 'story-id');
		expect(mocks.createForkedChat).toHaveBeenCalledWith(
			expect.objectContaining({ projectId: 'other-project-id', userId: 'owner-id' }),
			expect.anything(),
		);
	});

	it('forks an unshared Story owned by the user without checking the creation grant', async () => {
		await expect(createCaller('owner-id').chatFork.forkStory({ storyId: 'story-id' })).resolves.toEqual({
			chatId: 'fork-chat-id',
		});
		expect(mocks.resolveUserGroupAccess).not.toHaveBeenCalled();
		expect(mocks.getSharedStoryByStoryId).not.toHaveBeenCalled();
		expect(mocks.createStoryVersion).toHaveBeenCalledWith(
			expect.objectContaining({
				chatId: 'fork-chat-id',
				slug: 'story',
				code: '# Story\n<table query_id="query_a" />',
			}),
		);
		expect(mocks.getLatestSqlQueryDataByIds).toHaveBeenCalledWith('source-chat-id', new Set(['query_a']));
		expect(mocks.saveStoryInPrivateRoot).toHaveBeenCalledWith('owner-id', 'project-id', 'fork-story-id');
	});

	it("denies a fork of someone else's Story without the creation grant", async () => {
		await expect(createCaller().chatFork.forkStory({ storyId: 'story-id' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Story creation is not enabled for your user group.',
		});
		expect(mocks.createForkedChat).not.toHaveBeenCalled();
	});

	it("allows a fork of someone else's Story with the creation grant", async () => {
		mocks.resolveUserGroupAccess.mockResolvedValue({
			features: ['storyCreation'],
			toolCallDensityPolicy: { defaultDensity: 'detailed', canChange: true },
		});

		await expect(createCaller().chatFork.forkStory({ storyId: 'story-id' })).resolves.toEqual({
			chatId: 'fork-chat-id',
		});
		expect(mocks.resolveUserGroupAccess).toHaveBeenCalledWith('project-id', 'user-id');
		expect(mocks.createStoryVersion).toHaveBeenCalled();
		expect(mocks.saveStoryInPrivateRoot).toHaveBeenCalledWith('user-id', 'project-id', 'fork-story-id');
	});

	it('rejects a Story the user cannot see', async () => {
		mocks.getReferenceableStory.mockResolvedValue(null);

		await expect(createCaller('owner-id').chatFork.forkStory({ storyId: 'story-id' })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
		expect(mocks.createForkedChat).not.toHaveBeenCalled();
	});

	it('seeds the fork of a standalone Story with its cached query data', async () => {
		mocks.getReferenceableStory.mockResolvedValue(createReferenceableStory({ chatId: null }));
		mocks.getStoryDataCacheByStoryId.mockResolvedValue({
			queryData: {
				query_a: { columns: ['value'], data: [{ value: 1 }] },
				query_unused: { columns: ['value'], data: [{ value: 2 }] },
			},
		});

		await createCaller('owner-id').chatFork.forkStory({ storyId: 'story-id' });

		expect(mocks.getLatestSqlQueryDataByIds).not.toHaveBeenCalled();
		const seededMessages = JSON.stringify(mocks.createForkedChat.mock.calls[0][1]);
		expect(seededMessages).toContain('query_a');
		expect(seededMessages).not.toContain('query_unused');
	});

	it('copies the files of a custom Story and publishes them', async () => {
		mocks.getReferenceableStory.mockResolvedValue(createReferenceableStory({ format: 'custom', code: '' }));
		mocks.getLatestVersionByStoryId.mockResolvedValue({ id: 'version-id' });
		mocks.listVersionFiles.mockResolvedValue([
			{ path: 'app.jsx', content: 'useQuery("query_b")', storyVersionId: 'version-id' },
		]);
		mocks.createCustomStory.mockResolvedValue({ id: 'fork-story-id' });
		mocks.publishCustomStoryDraft.mockResolvedValue({ ok: true, version: 1, files: ['app.jsx'] });

		await createCaller('owner-id').chatFork.forkStory({ storyId: 'story-id' });

		expect(mocks.createStoryVersion).not.toHaveBeenCalled();
		expect(mocks.seedDraftFiles).toHaveBeenCalledWith('fork-story-id', [
			{ path: 'app.jsx', content: 'useQuery("query_b")' },
		]);
		expect(mocks.getLatestSqlQueryDataByIds).toHaveBeenCalledWith('source-chat-id', new Set(['query_b']));
		expect(mocks.publishCustomStoryDraft).toHaveBeenCalledWith(
			{ id: 'fork-story-id' },
			{ userId: 'owner-id', projectId: 'project-id' },
			'assistant',
		);
	});

	it('deletes the forked chat when the copy of a custom Story does not build', async () => {
		mocks.getReferenceableStory.mockResolvedValue(createReferenceableStory({ format: 'custom', code: '' }));
		mocks.getLatestVersionByStoryId.mockResolvedValue({ id: 'version-id' });
		mocks.listVersionFiles.mockResolvedValue([
			{ path: 'app.jsx', content: 'broken', storyVersionId: 'version-id' },
		]);
		mocks.createCustomStory.mockResolvedValue({ id: 'fork-story-id' });
		mocks.publishCustomStoryDraft.mockResolvedValue({ ok: false });

		await expect(createCaller('owner-id').chatFork.forkStory({ storyId: 'story-id' })).rejects.toThrow(
			'does not build',
		);
		expect(mocks.deleteChat).toHaveBeenCalledWith('fork-chat-id');
	});
});

function createReferenceableStory(overrides: Record<string, unknown>) {
	return {
		storyId: 'story-id',
		chatId: 'source-chat-id',
		chatTitle: 'Source chat',
		slug: 'story',
		title: 'Story',
		format: 'classic',
		authorName: 'Owner',
		ownerId: 'owner-id',
		isPinned: false,
		isCertified: false,
		isSharedWithMe: false,
		updatedAt: new Date(),
		versionId: 'version-id',
		version: 3,
		code: '# Story\n<table query_id="query_a" />',
		...overrides,
	};
}

function createCaller(userId = 'user-id') {
	return testRouter.createCaller({
		session: { user: { id: userId, name: 'Test User', email: 'test@example.com' } },
		selectedProjectId: 'project-id',
	} as never);
}
