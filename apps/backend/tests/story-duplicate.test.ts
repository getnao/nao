import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createCustomStoryDraft: vi.fn(),
	createStandaloneStory: vi.fn(),
	deleteStory: vi.fn(),
	executeLiveQuery: vi.fn(),
	getFolderById: vi.fn(),
	getLatestSqlQueryDataByIds: vi.fn(),
	getLatestVersionByStoryId: vi.fn(),
	getMcpQueryData: vi.fn(),
	getStoryById: vi.fn(),
	getStoryDataCacheByStoryId: vi.fn(),
	getStoryFolderItem: vi.fn(),
	getVersionByStoryIdAndNumber: vi.fn(),
	listOwnedStoryTitlesStartingWith: vi.fn(),
	listProjectStoryAppState: vi.fn(),
	listStandaloneSlugsStartingWith: vi.fn(),
	listUserStoryAppState: vi.fn(),
	listVersionFiles: vi.fn(),
	moveStoryToFolder: vi.fn(),
	publishCustomStoryDraft: vi.fn(),
	saveStoryInPrivateRoot: vi.fn(),
	upsertStoryAppState: vi.fn(),
	upsertStoryDataCacheByStoryId: vi.fn(),
}));

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/story.queries', () => ({
	createStandaloneStory: mocks.createStandaloneStory,
	deleteStory: mocks.deleteStory,
	getLatestVersionByStoryId: mocks.getLatestVersionByStoryId,
	getStoryById: mocks.getStoryById,
	getStoryDataCacheByStoryId: mocks.getStoryDataCacheByStoryId,
	getVersionByStoryIdAndNumber: mocks.getVersionByStoryIdAndNumber,
	listOwnedStoryTitlesStartingWith: mocks.listOwnedStoryTitlesStartingWith,
	listStandaloneSlugsStartingWith: mocks.listStandaloneSlugsStartingWith,
	upsertStoryDataCacheByStoryId: mocks.upsertStoryDataCacheByStoryId,
}));
vi.mock('../src/queries/execute-sql.queries', () => ({
	getLatestSqlQueryDataByChats: vi.fn(),
	getLatestSqlQueryDataByIds: mocks.getLatestSqlQueryDataByIds,
}));
vi.mock('../src/queries/mcp-query-data.queries', () => ({ getMcpQueryData: mocks.getMcpQueryData }));
vi.mock('../src/queries/story-app-state.queries', () => ({
	listProjectStoryAppState: mocks.listProjectStoryAppState,
	listUserStoryAppState: mocks.listUserStoryAppState,
	upsertStoryAppState: mocks.upsertStoryAppState,
}));
vi.mock('../src/queries/story-file.queries', () => ({ listVersionFiles: mocks.listVersionFiles }));
vi.mock('../src/queries/story-folder.queries', () => ({
	getFolderById: mocks.getFolderById,
	getStoryFolderItem: mocks.getStoryFolderItem,
	moveStoryToFolder: mocks.moveStoryToFolder,
	saveStoryInPrivateRoot: mocks.saveStoryInPrivateRoot,
}));
vi.mock('../src/services/live-story', () => ({ executeLiveQuery: mocks.executeLiveQuery }));
vi.mock('../src/services/custom-story-authoring', () => ({
	createCustomStoryDraft: mocks.createCustomStoryDraft,
	publishCustomStoryDraft: mocks.publishCustomStoryDraft,
}));

import { NO_CACHE_SCHEDULE } from '@nao/shared';

import { duplicateStory, StoryDuplicateError } from '../src/services/story-duplicate';

const OWNER = { userId: 'user-id', projectId: 'project-id' };
const CLASSIC_CODE = '# Revenue\n<table query_id="query_a" />';

describe('duplicateStory', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getStoryById.mockResolvedValue(createStory({}));
		mocks.getLatestVersionByStoryId.mockResolvedValue({ id: 'latest-version-id', version: 3, code: CLASSIC_CODE });
		mocks.getVersionByStoryIdAndNumber.mockResolvedValue({ id: 'old-version-id', version: 1, code: '# Old' });
		mocks.listOwnedStoryTitlesStartingWith.mockResolvedValue([]);
		mocks.listStandaloneSlugsStartingWith.mockResolvedValue([]);
		mocks.getStoryDataCacheByStoryId.mockResolvedValue(null);
		mocks.getLatestSqlQueryDataByIds.mockResolvedValue({});
		mocks.createStandaloneStory.mockResolvedValue({ id: 'copy-id' });
		mocks.getStoryFolderItem.mockResolvedValue(null);
		mocks.listProjectStoryAppState.mockResolvedValue([]);
		mocks.listUserStoryAppState.mockResolvedValue([]);
	});

	it('creates a standalone copy named after the original, in the private folder of the user', async () => {
		await expect(duplicateStory({ storyId: 'story-id' }, OWNER)).resolves.toEqual({
			storyId: 'copy-id',
			title: 'Copy of Revenue',
		});

		expect(mocks.createStandaloneStory).toHaveBeenCalledWith({
			userId: 'user-id',
			projectId: 'project-id',
			slug: 'copy-of-revenue',
			title: 'Copy of Revenue',
			code: CLASSIC_CODE,
			source: 'user',
		});
		expect(mocks.saveStoryInPrivateRoot).toHaveBeenCalledWith('user-id', 'project-id', 'copy-id');
	});

	it('numbers the copy when the name is taken, without stacking "Copy of"', async () => {
		mocks.getStoryById.mockResolvedValue(createStory({ title: 'Copy of Revenue (2)' }));
		mocks.listOwnedStoryTitlesStartingWith.mockResolvedValue([
			'Copy of Revenue',
			'Copy of Revenue (2)',
			'Copy of Revenue plan',
		]);
		mocks.listStandaloneSlugsStartingWith.mockResolvedValue(['copy-of-revenue-3']);

		await expect(duplicateStory({ storyId: 'story-id' }, OWNER)).resolves.toMatchObject({
			title: 'Copy of Revenue (3)',
		});
		expect(mocks.listOwnedStoryTitlesStartingWith).toHaveBeenCalledWith('user-id', 'project-id', 'Copy of Revenue');
		expect(mocks.createStandaloneStory).toHaveBeenCalledWith(
			expect.objectContaining({ slug: 'copy-of-revenue-3-2', title: 'Copy of Revenue (3)' }),
		);
	});

	it('copies the requested version', async () => {
		await duplicateStory({ storyId: 'story-id', versionNumber: 1 }, OWNER);

		expect(mocks.getVersionByStoryIdAndNumber).toHaveBeenCalledWith('story-id', 1);
		expect(mocks.createStandaloneStory).toHaveBeenCalledWith(expect.objectContaining({ code: '# Old' }));
	});

	it('refuses a version that does not exist', async () => {
		mocks.getVersionByStoryIdAndNumber.mockResolvedValue(null);

		await expect(duplicateStory({ storyId: 'story-id', versionNumber: 9 }, OWNER)).rejects.toBeInstanceOf(
			StoryDuplicateError,
		);
		expect(mocks.createStandaloneStory).not.toHaveBeenCalled();
	});

	it('freezes the rows of the chat a story reads, preferred over an older cache', async () => {
		mocks.getStoryDataCacheByStoryId.mockResolvedValue({
			queryData: { query_a: rows('cached'), query_unused: rows('unused') },
			analysisResults: { summary: 'Cached narrative' },
		});
		mocks.getLatestSqlQueryDataByIds.mockResolvedValue({ query_a: rows('chat') });

		await duplicateStory({ storyId: 'story-id' }, OWNER);

		expect(mocks.getLatestSqlQueryDataByIds).toHaveBeenCalledWith('chat-id', new Set(['query_a']));
		expect(mocks.upsertStoryDataCacheByStoryId).toHaveBeenCalledWith('copy-id', { query_a: rows('chat') }, null);
	});

	it('freezes the cached rows and narratives of a live story', async () => {
		mocks.getStoryById.mockResolvedValue(createStory({ isLive: true, isLiveTextDynamic: true }));
		mocks.getStoryDataCacheByStoryId.mockResolvedValue({
			queryData: { query_a: rows('cached') },
			analysisResults: { summary: 'Live narrative' },
		});
		mocks.getLatestSqlQueryDataByIds.mockResolvedValue({ query_a: rows('chat') });

		await duplicateStory({ storyId: 'story-id' }, OWNER);

		expect(mocks.upsertStoryDataCacheByStoryId).toHaveBeenCalledWith(
			'copy-id',
			{ query_a: rows('cached') },
			{ summary: 'Live narrative' },
		);
	});

	it('freezes the rows a live story without cache shows, by rerunning its queries', async () => {
		mocks.getStoryById.mockResolvedValue(createStory({ isLive: true, cacheSchedule: NO_CACHE_SCHEDULE }));
		mocks.getStoryDataCacheByStoryId.mockResolvedValue({ queryData: { query_a: rows('cached') } });
		mocks.getLatestSqlQueryDataByIds.mockResolvedValue({ query_a: rows('chat') });
		mocks.executeLiveQuery.mockResolvedValue(rows('live'));

		await duplicateStory({ storyId: 'story-id' }, OWNER);

		expect(mocks.executeLiveQuery).toHaveBeenCalledWith('chat-id', 'query_a');
		expect(mocks.upsertStoryDataCacheByStoryId).toHaveBeenCalledWith('copy-id', { query_a: rows('live') }, null);
	});

	it('keeps the copy next to the original when it sits in a private folder of the user', async () => {
		mocks.getStoryFolderItem.mockResolvedValue({ folderId: 'folder-id' });
		mocks.getFolderById.mockResolvedValue({
			id: 'folder-id',
			ownerId: 'user-id',
			visibility: 'private',
			archivedAt: null,
		});

		await duplicateStory({ storyId: 'story-id' }, OWNER);

		expect(mocks.moveStoryToFolder).toHaveBeenCalledWith('copy-id', 'folder-id', {
			storyOwnerId: 'user-id',
			projectId: 'project-id',
		});
		expect(mocks.saveStoryInPrivateRoot).not.toHaveBeenCalled();
	});

	it('never shares the copy by placing it in a public folder', async () => {
		mocks.getStoryFolderItem.mockResolvedValue({ folderId: 'folder-id' });
		mocks.getFolderById.mockResolvedValue({
			id: 'folder-id',
			ownerId: 'user-id',
			visibility: 'public',
			archivedAt: null,
		});

		await duplicateStory({ storyId: 'story-id' }, OWNER);

		expect(mocks.moveStoryToFolder).not.toHaveBeenCalled();
		expect(mocks.saveStoryInPrivateRoot).toHaveBeenCalledWith('user-id', 'project-id', 'copy-id');
	});

	describe('custom story', () => {
		beforeEach(() => {
			mocks.getStoryById.mockResolvedValue(createStory({ format: 'custom' }));
			mocks.getLatestVersionByStoryId.mockResolvedValue({ id: 'latest-version-id', version: 3, code: '' });
			mocks.listVersionFiles.mockResolvedValue([
				{ path: 'app.jsx', content: 'useQueryData("query_b")', storyVersionId: 'latest-version-id' },
			]);
			mocks.getLatestSqlQueryDataByIds.mockResolvedValue({ query_b: rows('chat') });
			mocks.createCustomStoryDraft.mockResolvedValue({ story: { id: 'copy-id' }, files: ['app.jsx'] });
			mocks.publishCustomStoryDraft.mockResolvedValue({ ok: true, version: 1, files: ['app.jsx'] });
		});

		it('publishes a standalone copy of the version files that reads the frozen rows', async () => {
			mocks.listProjectStoryAppState.mockResolvedValue([
				{ scope: 'project', userId: null, key: 'scenario', value: { growth: 3 } },
			]);
			mocks.listUserStoryAppState.mockResolvedValue([
				{ scope: 'user', userId: 'user-id', key: 'region', value: 'EMEA' },
			]);

			await duplicateStory({ storyId: 'story-id' }, OWNER);

			expect(mocks.createCustomStoryDraft).toHaveBeenCalledWith({
				userId: 'user-id',
				projectId: 'project-id',
				slug: 'copy-of-revenue',
				title: 'Copy of Revenue',
				files: [{ path: 'app.jsx', content: 'useQueryData("query_b")' }],
			});
			expect(mocks.upsertStoryDataCacheByStoryId).toHaveBeenCalledWith(
				'copy-id',
				{ query_b: rows('chat') },
				null,
			);
			expect(mocks.upsertStoryAppState).toHaveBeenCalledWith(
				{ storyId: 'copy-id', scope: 'project', userId: null, key: 'scenario' },
				{ growth: 3 },
				'user-id',
			);
			expect(mocks.listUserStoryAppState).toHaveBeenCalledWith('story-id', 'user-id');
			expect(mocks.upsertStoryAppState).toHaveBeenCalledWith(
				{ storyId: 'copy-id', scope: 'user', userId: 'user-id', key: 'region' },
				'EMEA',
				'user-id',
			);
			expect(mocks.publishCustomStoryDraft).toHaveBeenCalledWith({ id: 'copy-id' }, OWNER, 'user');
		});

		it('deletes the copy when it does not build', async () => {
			mocks.publishCustomStoryDraft.mockResolvedValue({ ok: false, buildErrors: ['broken'], files: [] });

			await expect(duplicateStory({ storyId: 'story-id' }, OWNER)).rejects.toBeInstanceOf(StoryDuplicateError);
			expect(mocks.deleteStory).toHaveBeenCalledWith('copy-id');
			expect(mocks.saveStoryInPrivateRoot).not.toHaveBeenCalled();
		});
	});
});

function createStory(overrides: Record<string, unknown>) {
	return {
		id: 'story-id',
		chatId: 'chat-id',
		projectId: null,
		userId: null,
		slug: 'revenue',
		title: 'Revenue',
		format: 'classic',
		isLive: false,
		isLiveTextDynamic: false,
		...overrides,
	};
}

function rows(value: string) {
	return { columns: ['value'], data: [{ value }] };
}
