import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getChatInfo: vi.fn(),
	getChatProjectId: vi.fn(),
	getEnvVars: vi.fn(),
	getLatestVersionByChatAndSlug: vi.fn(),
	getSqlQueriesFromCode: vi.fn(),
	getSqlQueryById: vi.fn(),
	getStoryDataCacheByChatAndSlug: vi.fn(),
	getQueryDataFromCode: vi.fn(),
	queryAppDb: vi.fn(),
	buildMcpToolContext: vi.fn(),
	resolveExcludedColumnEnforcement: vi.fn(),
	upsertStoryDataCache: vi.fn(),
	findMissingQueryIds: vi.fn(),
	backfillMissingQueryData: vi.fn(),
}));

vi.mock('../src/agents/tools/query-app-db', () => ({
	queryAppDb: mocks.queryAppDb,
}));

vi.mock('../src/queries/chat.queries', () => ({
	getChatInfo: mocks.getChatInfo,
	getChatProjectId: mocks.getChatProjectId,
}));

vi.mock('../src/queries/project-llm-config.queries', () => ({
	getProjectModelProvider: vi.fn(),
}));

vi.mock('../src/queries/story.queries', () => ({
	getLatestVersionByChatAndSlug: mocks.getLatestVersionByChatAndSlug,
	getSqlQueriesFromCode: mocks.getSqlQueriesFromCode,
	getSqlQueryById: mocks.getSqlQueryById,
	getStoryDataCacheByChatAndSlug: mocks.getStoryDataCacheByChatAndSlug,
	upsertStoryDataCache: mocks.upsertStoryDataCache,
}));

vi.mock('../src/queries/shared-story.queries', () => ({
	getQueryDataFromCode: mocks.getQueryDataFromCode,
}));

vi.mock('../src/services/agent', () => ({
	buildMcpToolContext: mocks.buildMcpToolContext,
	MAX_OUTPUT_TOKENS: 4096,
}));

vi.mock('../src/services/excluded-columns.service', () => ({
	resolveExcludedColumnEnforcement: mocks.resolveExcludedColumnEnforcement,
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
	backfillMissingQueryData: mocks.backfillMissingQueryData,
	findMissingQueryIds: mocks.findMissingQueryIds,
}));

import { executeLiveQuery, getStoryQueryData, refreshStoryData } from '../src/services/live-story';

function querySource(sql: string, databaseId: string | null = null, adminMode = false) {
	return {
		fingerprint: createHash('sha256').update(JSON.stringify({ sql, databaseId, adminMode })).digest('hex'),
		databaseId,
		adminMode,
	};
}

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
			code: '<table query_id="query_admin" />',
			isLiveTextDynamic: false,
		});
		mocks.buildMcpToolContext.mockResolvedValue({
			projectFolder: '/project',
			projectId: 'project-1',
			userId: 'user-1',
			envVars: { TOKEN: 'secret' },
			azureAccessToken: null,
			agentSettings: null,
			warehouseTableAccess: { enforced: false },
		});
		mocks.resolveExcludedColumnEnforcement.mockResolvedValue(false);
		mocks.getStoryDataCacheByChatAndSlug.mockResolvedValue(null);
		mocks.findMissingQueryIds.mockReturnValue([]);
		mocks.upsertStoryDataCache.mockResolvedValue({});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('refreshes admin-mode story queries from the app database', async () => {
		mocks.getChatProjectId.mockResolvedValue(null);
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

		await expect(refreshStoryData('chat-1', 'usage', 'user-1')).resolves.toEqual({
			queryData: {
				query_admin: {
					columns: ['chat_id'],
					data: [{ chat_id: 'chat-1' }],
				},
			},
		});

		expect(mocks.queryAppDb).toHaveBeenCalledWith('project-1', 'SELECT * FROM v_messages');
		expect(mocks.buildMcpToolContext).not.toHaveBeenCalled();
		expect(mocks.upsertStoryDataCache).toHaveBeenCalledWith(
			'chat-1',
			'usage',
			{
				query_admin: {
					columns: ['chat_id'],
					data: [{ chat_id: 'chat-1' }],
				},
			},
			{
				query_admin: querySource('SELECT * FROM v_messages', null, true),
			},
		);
	});

	it('keeps warehouse story queries on the existing SQL endpoint', async () => {
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_warehouse: {
				sqlQuery: 'SELECT * FROM orders',
				databaseId: 'analytics',
				adminMode: false,
			},
		});
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				columns: ['order_id'],
				data: [{ order_id: 1 }],
			}),
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(refreshStoryData('chat-1', 'orders', 'user-1')).resolves.toEqual({
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
			enforce_excluded_columns: false,
			table_access: { enforced: false },
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

		await expect(executeLiveQuery('chat-1', 'query_admin', 'user-1')).resolves.toEqual({
			columns: ['chat_id'],
			data: [{ chat_id: 'chat-1' }],
		});

		expect(mocks.queryAppDb).toHaveBeenCalledWith('project-1', 'SELECT chat_id FROM v_messages');
		expect(mocks.buildMcpToolContext).not.toHaveBeenCalled();
	});

	it('does not serve a higher-access live cache to a restricted viewer', async () => {
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_warehouse: { sqlQuery: 'SELECT * FROM users', adminMode: false },
		});
		mocks.getStoryDataCacheByChatAndSlug.mockResolvedValue({
			queryData: { query_warehouse: { columns: ['id'], data: [{ id: 1 }] } },
			querySources: { query_warehouse: querySource('SELECT * FROM users') },
			cachedAt: new Date(),
		});
		mocks.buildMcpToolContext.mockResolvedValue({
			projectFolder: '/project',
			projectId: 'project-1',
			userId: 'viewer-1',
			envVars: {},
			azureAccessToken: null,
			agentSettings: null,
			warehouseTableAccess: { enforced: true, strict: true, tables: [] },
		});
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				json: vi.fn().mockResolvedValue({ detail: 'Denied table(s): main.users' }),
			}),
		);

		await expect(
			getStoryQueryData('chat-1', 'users', '<table query_id="query_warehouse" />', true, null, 'viewer-1'),
		).rejects.toThrow('main.users');
	});

	it('validates once and reuses a live cache for an allowed viewer', async () => {
		const cache = {
			queryData: { query_warehouse: { columns: ['id'], data: [{ id: 1 }] } },
			querySources: { query_warehouse: querySource('SELECT * FROM orders') },
			cachedAt: new Date(),
		};
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_warehouse: { sqlQuery: 'SELECT * FROM orders', adminMode: false },
		});
		mocks.getStoryDataCacheByChatAndSlug.mockResolvedValue(cache);
		mocks.buildMcpToolContext.mockResolvedValue({
			projectFolder: '/project',
			projectId: 'project-1',
			userId: 'viewer-1',
			envVars: {},
			azureAccessToken: 'azure-token',
			agentSettings: null,
			warehouseTableAccess: {
				enforced: true,
				strict: true,
				tables: [
					{
						databaseType: 'duckdb',
						database: 'analytics',
						schema: 'main',
						table: 'orders',
					},
				],
			},
		});
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({ valid: true, dialect: 'duckdb' }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			getStoryQueryData('chat-1', 'orders', '<table query_id="query_warehouse" />', true, null, 'viewer-1'),
		).resolves.toEqual({
			queryData: cache.queryData,
			cachedAt: cache.cachedAt,
			code: '<table query_id="query_warehouse" />',
		});
		expect(mocks.buildMcpToolContext).toHaveBeenCalledOnce();
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock.mock.calls[0][0]).toContain('/validate_sql');
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
			azure_access_token: 'azure-token',
			table_access: {
				enforced: true,
				tables: [
					{
						database_type: 'duckdb',
						database: 'analytics',
						schema: 'main',
						table: 'orders',
					},
				],
			},
		});
	});

	it('re-executes when a reused query id has different SQL provenance', async () => {
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			code: '<table query_id="query_warehouse" />',
			isLiveTextDynamic: false,
		});
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_warehouse: { sqlQuery: 'SELECT * FROM orders', adminMode: false },
		});
		mocks.getStoryDataCacheByChatAndSlug.mockResolvedValue({
			queryData: { query_warehouse: { columns: ['secret'], data: [{ secret: 'old users data' }] } },
			querySources: { query_warehouse: querySource('SELECT * FROM users') },
			cachedAt: new Date(),
		});
		mocks.buildMcpToolContext.mockResolvedValue({
			projectFolder: '/project',
			projectId: 'project-1',
			userId: 'viewer-1',
			envVars: {},
			azureAccessToken: null,
			agentSettings: null,
			warehouseTableAccess: { enforced: true, strict: true, tables: [] },
		});
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({ columns: ['id'], data: [{ id: 7 }] }),
			}),
		);

		await expect(
			getStoryQueryData('chat-1', 'orders', '<table query_id="query_warehouse" />', true, null, 'viewer-1'),
		).resolves.toMatchObject({
			queryData: { query_warehouse: { columns: ['id'], data: [{ id: 7 }] } },
		});
		expect(mocks.upsertStoryDataCache).toHaveBeenCalledWith(
			'chat-1',
			'orders',
			{ query_warehouse: { columns: ['id'], data: [{ id: 7 }] } },
			{ query_warehouse: querySource('SELECT * FROM orders') },
		);
	});

	it('fails closed when a referenced query has no SQL record', async () => {
		mocks.getSqlQueriesFromCode.mockResolvedValue({});
		mocks.buildMcpToolContext.mockResolvedValue({
			projectFolder: '/project',
			projectId: 'project-1',
			userId: 'viewer-1',
			envVars: {},
			azureAccessToken: null,
			agentSettings: null,
			warehouseTableAccess: { enforced: true, strict: true, tables: [] },
		});
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			getStoryQueryData('chat-1', 'missing', '<table query_id="query_missing" />', true, null, 'viewer-1'),
		).rejects.toThrow('sources could not be resolved');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('re-executes an enforced legacy cache without provenance', async () => {
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			code: '<table query_id="query_warehouse" />',
			isLiveTextDynamic: false,
		});
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_warehouse: { sqlQuery: 'SELECT * FROM orders', adminMode: false },
		});
		mocks.getStoryDataCacheByChatAndSlug.mockResolvedValue({
			queryData: { query_warehouse: { columns: ['id'], data: [{ id: 1 }] } },
			querySources: null,
			cachedAt: new Date(),
		});
		mocks.buildMcpToolContext.mockResolvedValue({
			projectFolder: '/project',
			projectId: 'project-1',
			userId: 'viewer-1',
			envVars: {},
			azureAccessToken: null,
			agentSettings: null,
			warehouseTableAccess: { enforced: true, strict: true, tables: [] },
		});
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({ columns: ['id'], data: [{ id: 2 }] }),
			}),
		);

		await expect(
			getStoryQueryData('chat-1', 'orders', '<table query_id="query_warehouse" />', true, null, 'viewer-1'),
		).resolves.toMatchObject({
			queryData: { query_warehouse: { columns: ['id'], data: [{ id: 2 }] } },
		});
	});

	it('removes stale extra query keys from a validated cache', async () => {
		const cachedAt = new Date();
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_orders: { sqlQuery: 'SELECT * FROM orders', adminMode: false },
		});
		mocks.getStoryDataCacheByChatAndSlug.mockResolvedValue({
			queryData: {
				query_orders: { columns: ['id'], data: [{ id: 1 }] },
				query_users: { columns: ['secret'], data: [{ secret: 'hidden' }] },
			},
			querySources: {
				query_orders: querySource('SELECT * FROM orders'),
				query_users: querySource('SELECT * FROM users'),
			},
			cachedAt,
		});
		mocks.buildMcpToolContext.mockResolvedValue({
			projectFolder: '/project',
			projectId: 'project-1',
			userId: 'viewer-1',
			envVars: {},
			azureAccessToken: null,
			agentSettings: null,
			warehouseTableAccess: { enforced: true, strict: true, tables: [] },
		});
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({ valid: true, dialect: 'duckdb' }),
			}),
		);

		await expect(
			getStoryQueryData('chat-1', 'orders', '<table query_id="query_orders" />', true, null, 'viewer-1'),
		).resolves.toEqual({
			queryData: { query_orders: { columns: ['id'], data: [{ id: 1 }] } },
			cachedAt,
			code: '<table query_id="query_orders" />',
		});
	});

	it('does not validate a valid cache when Context access is unenforced', async () => {
		const cache = {
			queryData: { query_warehouse: { columns: ['id'], data: [{ id: 1 }] } },
			querySources: null,
			cachedAt: new Date(),
		};
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_warehouse: { sqlQuery: 'SELECT * FROM orders', adminMode: false },
		});
		mocks.getStoryDataCacheByChatAndSlug.mockResolvedValue(cache);
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			statusText: 'Unavailable',
			json: vi.fn().mockResolvedValue({ detail: 'validation unavailable' }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			getStoryQueryData('chat-1', 'orders', '<table query_id="query_warehouse" />', true, null, 'user-1'),
		).resolves.toEqual({
			queryData: cache.queryData,
			cachedAt: cache.cachedAt,
			code: '<table query_id="query_warehouse" />',
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('reuses admin-only cache without building MCP context', async () => {
		const code = '<table query_id="query_admin" />';
		const cache = {
			queryData: { query_admin: { columns: ['chat_id'], data: [{ chat_id: 'chat-1' }] } },
			querySources: { query_admin: querySource('SELECT * FROM v_messages', null, true) },
			cachedAt: new Date(),
		};
		mocks.getChatProjectId.mockResolvedValue(null);
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_admin: { sqlQuery: 'SELECT * FROM v_messages', adminMode: true },
		});
		mocks.getStoryDataCacheByChatAndSlug.mockResolvedValue(cache);

		await expect(getStoryQueryData('chat-1', 'usage', code, true, null, 'user-1')).resolves.toEqual({
			queryData: cache.queryData,
			cachedAt: cache.cachedAt,
			code,
		});
		expect(mocks.buildMcpToolContext).not.toHaveBeenCalled();
		expect(mocks.queryAppDb).not.toHaveBeenCalled();
	});
});
