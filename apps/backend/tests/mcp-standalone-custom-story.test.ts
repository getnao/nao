import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	applyCustomStoryDraftChanges: vi.fn(),
	createCustomStoryDraft: vi.fn(),
	getLatestVersionByStoryId: vi.fn(),
	getMcpQueryData: vi.fn(),
	getStandaloneStoryByUserAndSlug: vi.fn(),
	getStoryByChatAndSlug: vi.fn(),
	getStoryById: vi.fn(),
	getStoryDataCacheByStoryId: vi.fn(),
	getStoryProjectId: vi.fn(),
	listDraftFiles: vi.fn(),
	publishCustomStoryDraft: vi.fn(),
	renameStory: vi.fn(),
	resolveChartChatId: vi.fn(),
	upsertStoryDataCacheByStoryId: vi.fn(),
}));

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/components/ai/story-kit-guide', () => ({ renderStoryKitGuide: () => '' }));
vi.mock('../src/queries/story.queries', () => ({
	getLatestVersionByStoryId: mocks.getLatestVersionByStoryId,
	getStandaloneStoryByUserAndSlug: mocks.getStandaloneStoryByUserAndSlug,
	getStoryByChatAndSlug: mocks.getStoryByChatAndSlug,
	getStoryById: mocks.getStoryById,
	getStoryDataCacheByStoryId: mocks.getStoryDataCacheByStoryId,
	getStoryProjectId: mocks.getStoryProjectId,
	renameStory: mocks.renameStory,
	upsertStoryDataCacheByStoryId: mocks.upsertStoryDataCacheByStoryId,
}));
vi.mock('../src/queries/story-file.queries', () => ({ listDraftFiles: mocks.listDraftFiles }));
vi.mock('../src/queries/mcp-query-data.queries', () => ({ getMcpQueryData: mocks.getMcpQueryData }));
vi.mock('../src/services/custom-story-authoring', () => ({
	applyCustomStoryDraftChanges: mocks.applyCustomStoryDraftChanges,
	createCustomStoryDraft: mocks.createCustomStoryDraft,
	publishCustomStoryDraft: mocks.publishCustomStoryDraft,
}));
vi.mock('../src/mcp/tools/helpers', () => ({
	fetchLatestStoryVersion: vi.fn(),
	resolveChartChatId: mocks.resolveChartChatId,
}));

import {
	createCustomStoryForMcp,
	resolveCustomStory,
	updateCustomStoryForMcp,
} from '../src/mcp/tools/custom-story-mcp';

const ctx = { userId: 'user-id', projectId: 'project-id' } as never;
const APP_FILES = [{ path: 'app.jsx', content: 'useQueryData("query_mcp"); useQueryData("query_ask")' }];
const STANDALONE_STORY = {
	id: 'story-id',
	chatId: null,
	projectId: 'project-id',
	userId: 'user-id',
	slug: 'revenue-app',
	title: 'Revenue app',
	format: 'custom',
};

describe('custom stories through MCP without a chat', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getStandaloneStoryByUserAndSlug.mockResolvedValue(null);
		mocks.createCustomStoryDraft.mockResolvedValue({ story: STANDALONE_STORY, files: ['app.jsx'] });
		mocks.listDraftFiles.mockResolvedValue(APP_FILES);
		mocks.getStoryDataCacheByStoryId.mockResolvedValue(null);
		mocks.getMcpQueryData.mockResolvedValue({ columns: ['value'], data: [{ value: 'mcp' }] });
		mocks.publishCustomStoryDraft.mockResolvedValue({ ok: true, version: 1, files: ['app.jsx'] });
	});

	it('creates a standalone custom story that saves the rows its app reads before publishing', async () => {
		const result = await createCustomStoryForMcp(
			{
				chatId: undefined,
				title: 'Revenue app',
				files: APP_FILES,
				queryData: { query_ask: { columns: ['value'], data: [{ value: 'ask' }] } },
			},
			ctx,
		);

		expect(result.isError).toBeFalsy();
		expect(mocks.createCustomStoryDraft).toHaveBeenCalledWith({
			projectId: 'project-id',
			userId: 'user-id',
			slug: 'revenue-app',
			title: 'Revenue app',
			files: APP_FILES,
		});
		expect(mocks.getMcpQueryData).toHaveBeenCalledWith('query_mcp', 'project-id', { userId: 'user-id' });
		expect(mocks.upsertStoryDataCacheByStoryId).toHaveBeenCalledWith('story-id', {
			query_ask: { columns: ['value'], data: [{ value: 'ask' }] },
			query_mcp: { columns: ['value'], data: [{ value: 'mcp' }] },
		});
		expect(mocks.upsertStoryDataCacheByStoryId.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.publishCustomStoryDraft.mock.invocationCallOrder[0],
		);
	});

	it('refuses a title already used by a standalone story of the user', async () => {
		mocks.getStandaloneStoryByUserAndSlug.mockResolvedValue(STANDALONE_STORY);

		const result = await createCustomStoryForMcp(
			{ chatId: undefined, title: 'Revenue app', files: APP_FILES, queryData: undefined },
			ctx,
		);

		expect(result.isError).toBe(true);
		expect(mocks.createCustomStoryDraft).not.toHaveBeenCalled();
	});

	it('refuses `query_data` for a custom story attached to a chat', async () => {
		mocks.resolveChartChatId.mockResolvedValue('chat-id');

		const result = await createCustomStoryForMcp(
			{ chatId: 'chat-id', title: 'Revenue app', files: APP_FILES, queryData: { query_ask: rows() } },
			ctx,
		);

		expect(result.isError).toBe(true);
		expect(mocks.createCustomStoryDraft).not.toHaveBeenCalled();
	});

	it('resolves a standalone custom story of the user for updates', async () => {
		mocks.getStoryById.mockResolvedValue(STANDALONE_STORY);
		mocks.getStoryProjectId.mockResolvedValue('project-id');

		await expect(resolveCustomStory('story-id', ctx)).resolves.toEqual(STANDALONE_STORY);
	});

	it('refreshes the saved rows of a standalone custom story on update, keeping the rows it already had', async () => {
		mocks.getStoryDataCacheByStoryId.mockResolvedValue({ queryData: { query_ask: rows() } });

		await updateCustomStoryForMcp(
			STANDALONE_STORY as never,
			{ title: undefined, files: APP_FILES, deletePaths: [], queryData: undefined },
			ctx,
		);

		expect(mocks.upsertStoryDataCacheByStoryId).toHaveBeenCalledWith('story-id', {
			query_ask: rows(),
			query_mcp: { columns: ['value'], data: [{ value: 'mcp' }] },
		});
		expect(mocks.publishCustomStoryDraft).toHaveBeenCalled();
	});
});

function rows() {
	return { columns: ['value'], data: [{ value: 'ask' }] };
}
