import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getChatInfo: vi.fn(),
	getChatProjectId: vi.fn(),
	getEnvVars: vi.fn(),
	getLatestVersionByChatAndSlug: vi.fn(),
	getSqlQueriesFromCode: vi.fn(),
	getSqlQueryById: vi.fn(),
	queryAppDb: vi.fn(),
	retrieveProjectById: vi.fn(),
	upsertStoryDataCache: vi.fn(),
}));

vi.mock('../src/agents/tools/query-app-db', () => ({
	queryAppDb: mocks.queryAppDb,
}));

vi.mock('../src/queries/chat.queries', () => ({
	getChatInfo: mocks.getChatInfo,
	getChatProjectId: mocks.getChatProjectId,
}));

vi.mock('../src/queries/project.queries', () => ({
	getEnvVars: mocks.getEnvVars,
	retrieveProjectById: mocks.retrieveProjectById,
}));

vi.mock('../src/queries/project-llm-config.queries', () => ({
	getProjectModelProvider: vi.fn(),
}));

vi.mock('../src/queries/story.queries', () => ({
	getLatestVersionByChatAndSlug: mocks.getLatestVersionByChatAndSlug,
	getSqlQueriesFromCode: mocks.getSqlQueriesFromCode,
	getSqlQueryById: mocks.getSqlQueryById,
	upsertStoryDataCache: mocks.upsertStoryDataCache,
}));

vi.mock('../src/queries/shared-story.queries', () => ({
	getQueryDataFromCode: vi.fn(),
}));

vi.mock('../src/services/agent', () => ({
	MAX_OUTPUT_TOKENS: 4096,
}));

vi.mock('../src/utils/llm', () => ({
	getDefaultModelId: vi.fn(),
	resolveDefaultModelSelection: vi.fn(),
	resolveProviderModel: vi.fn(),
}));

vi.mock('../src/utils/schedule-task', () => ({
	scheduleSaveLlmInferenceRecord: vi.fn(),
}));

vi.mock('../src/utils/story-query-data', () => ({
	backfillMissingQueryData: vi.fn(),
	findMissingQueryIds: vi.fn(),
}));

import { executeLiveQuery, refreshStoryData } from '../src/services/live-story';

describe('live story SQL execution', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.getChatInfo.mockResolvedValue({
			projectId: 'project-1',
			userId: 'user-1',
			title: 'Chat',
		});
		mocks.getChatProjectId.mockResolvedValue('project-1');
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			code: '<table query="query_admin" />',
			isLiveTextDynamic: false,
		});
		mocks.upsertStoryDataCache.mockResolvedValue({});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('refreshes admin-mode story queries from the app database', async () => {
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_admin: {
				sqlQuery: 'SELECT * FROM v_messages',
				adminMode: true,
			},
		});
		mocks.queryAppDb.mockResolvedValue({
			_version: '1',
			columns: ['chat_id'],
			rows: [{ chat_id: 'chat-1' }],
			rowCount: 1,
		});

		await expect(refreshStoryData('chat-1', 'usage')).resolves.toEqual({
			queryData: {
				query_admin: {
					columns: ['chat_id'],
					data: [{ chat_id: 'chat-1' }],
				},
			},
		});

		expect(mocks.queryAppDb).toHaveBeenCalledWith('project-1', 'SELECT * FROM v_messages');
		expect(mocks.retrieveProjectById).not.toHaveBeenCalled();
		expect(mocks.getEnvVars).not.toHaveBeenCalled();
		expect(mocks.upsertStoryDataCache).toHaveBeenCalledWith('chat-1', 'usage', {
			query_admin: {
				columns: ['chat_id'],
				data: [{ chat_id: 'chat-1' }],
			},
		});
	});

	it('keeps warehouse story queries on the existing SQL endpoint', async () => {
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_warehouse: {
				sqlQuery: 'SELECT * FROM orders',
				databaseId: 'analytics',
				adminMode: false,
			},
		});
		mocks.retrieveProjectById.mockResolvedValue({ path: '/project' });
		mocks.getEnvVars.mockResolvedValue({ TOKEN: 'secret' });
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				columns: ['order_id'],
				data: [{ order_id: 1 }],
			}),
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(refreshStoryData('chat-1', 'orders')).resolves.toEqual({
			queryData: {
				query_warehouse: {
					columns: ['order_id'],
					data: [{ order_id: 1 }],
				},
			},
		});

		expect(mocks.queryAppDb).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
			sql: 'SELECT * FROM orders',
			nao_project_folder: '/project',
			database_id: 'analytics',
			env_vars: { TOKEN: 'secret' },
		});
	});

	it('uses the app database when a single live query came from admin mode', async () => {
		mocks.getSqlQueryById.mockResolvedValue({
			sqlQuery: 'SELECT chat_id FROM v_messages',
			adminMode: true,
		});
		mocks.queryAppDb.mockResolvedValue({
			_version: '1',
			columns: ['chat_id'],
			rows: [{ chat_id: 'chat-1' }],
			rowCount: 1,
		});

		await expect(executeLiveQuery('chat-1', 'query_admin')).resolves.toEqual({
			columns: ['chat_id'],
			data: [{ chat_id: 'chat-1' }],
		});

		expect(mocks.queryAppDb).toHaveBeenCalledWith('project-1', 'SELECT chat_id FROM v_messages');
		expect(mocks.retrieveProjectById).not.toHaveBeenCalled();
	});
});
