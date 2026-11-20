import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getChatInfo: vi.fn(),
	getChatOwnerId: vi.fn(),
	getChatProjectId: vi.fn(),
	getStoryByChatAndSlug: vi.fn(),
	getStoryById: vi.fn(),
	getStoryOwnerId: vi.fn(),
	getStoryProjectId: vi.fn(),
	getLatestVersionByStoryId: vi.fn(),
	getLatestSqlQueriesByIds: vi.fn(),
	getLatestSqlQueryDataByIds: vi.fn(),
	listStoryQueries: vi.fn(),
	getSqlQueriesByIds: vi.fn(),
	getSqlQueryById: vi.fn(),
	getStoryDataCacheByChatAndSlug: vi.fn(),
	getStoryDataCacheByStoryId: vi.fn(),
	getUserRoleInProject: vi.fn(),
	getQueryDataFromCode: vi.fn(),
	queryAppDb: vi.fn(),
	runQueryOnLocalFiles: vi.fn(),
	buildToolContext: vi.fn(),
	buildChatlessToolContext: vi.fn(),
	resolveExcludedColumnEnforcement: vi.fn(),
	upsertStoryDataCacheByStoryId: vi.fn(),
	updateVersionCodeIfLatest: vi.fn(),
	findMissingQueryIds: vi.fn(),
	backfillMissingQueryData: vi.fn(),
	generateText: vi.fn(),
	resolveDefaultChatModel: vi.fn(),
	resolveDefaultModelSelection: vi.fn(),
	resolveProviderModel: vi.fn(),
	extractCustomStoryQueryIds: vi.fn(),
	listVersionFiles: vi.fn(),
}));

vi.mock('ai', async (importOriginal) => ({
	...(await importOriginal<typeof import('ai')>()),
	generateText: mocks.generateText,
}));

vi.mock('../../src/agents/tools/query-app-db', () => ({
	queryAppDb: mocks.queryAppDb,
}));

vi.mock('../../src/queries/chat.queries', () => ({
	getChatInfo: mocks.getChatInfo,
	getChatOwnerId: mocks.getChatOwnerId,
	getChatProjectId: mocks.getChatProjectId,
}));

vi.mock('../../src/queries/execute-sql.queries', () => ({
	getLatestSqlQueriesByIds: mocks.getLatestSqlQueriesByIds,
	getLatestSqlQueryDataByIds: mocks.getLatestSqlQueryDataByIds,
}));

vi.mock('../../src/queries/project.queries', () => ({
	getUserRoleInProject: mocks.getUserRoleInProject,
}));

vi.mock('../../src/queries/story-query.queries', () => ({
	listStoryQueries: mocks.listStoryQueries,
}));

vi.mock('../../src/queries/story.queries', () => ({
	getStoryByChatAndSlug: mocks.getStoryByChatAndSlug,
	getStoryById: mocks.getStoryById,
	getStoryOwnerId: mocks.getStoryOwnerId,
	getStoryProjectId: mocks.getStoryProjectId,
	getLatestVersionByStoryId: mocks.getLatestVersionByStoryId,
	getSqlQueriesByIds: mocks.getSqlQueriesByIds,
	getSqlQueryById: mocks.getSqlQueryById,
	getStoryDataCacheByChatAndSlug: mocks.getStoryDataCacheByChatAndSlug,
	getStoryDataCacheByStoryId: mocks.getStoryDataCacheByStoryId,
	upsertStoryDataCacheByStoryId: mocks.upsertStoryDataCacheByStoryId,
	updateVersionCodeIfLatest: mocks.updateVersionCodeIfLatest,
}));

vi.mock('../../src/queries/shared-story.queries', () => ({
	getQueryDataFromCode: mocks.getQueryDataFromCode,
}));

vi.mock('../../src/services/agent', () => ({
	buildToolContext: mocks.buildToolContext,
	buildChatlessToolContext: mocks.buildChatlessToolContext,
	MAX_OUTPUT_TOKENS: 4096,
}));

vi.mock('../../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: vi.fn(),
}));

vi.mock('../../src/services/local-query.service', () => ({
	runQueryOnLocalFiles: mocks.runQueryOnLocalFiles,
}));

vi.mock('../../src/services/excluded-columns.service', () => ({
	resolveExcludedColumnEnforcement: mocks.resolveExcludedColumnEnforcement,
}));

vi.mock('../../src/utils/llm', () => ({
	resolveDefaultChatModel: mocks.resolveDefaultChatModel,
	resolveDefaultModelSelection: mocks.resolveDefaultModelSelection,
	resolveProviderModel: mocks.resolveProviderModel,
}));

vi.mock('../../src/utils/logger', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/utils/logger')>()),
	logger: (await import('../helpers/logger-mock')).logger,
}));

vi.mock('../../src/utils/schedule-task', () => ({
	scheduleSaveLlmInferenceRecord: vi.fn(),
}));

vi.mock('../../src/utils/story-query-data', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/utils/story-query-data')>()),
	backfillMissingQueryData: mocks.backfillMissingQueryData,
	findMissingQueryIds: mocks.findMissingQueryIds,
	extractCustomStoryQueryIds: mocks.extractCustomStoryQueryIds,
}));

vi.mock('../../src/queries/story-file.queries', () => ({
	listVersionFiles: mocks.listVersionFiles,
}));

import { assertProjectCloudBillingAccess } from '../../src/services/cloud-billing-access.service';
import {
	createStoryExecutionContext,
	executeLiveQuery,
	executeRawSql,
	executeStoryLiveQuery,
	getStoryQueryData,
	hasOnlyFrozenQueries,
	refreshStoryById,
	refreshStoryData,
} from '../../src/services/live-story';
import { logger } from '../../src/utils/logger';

const WAREHOUSE_STORY_CODE = '<table query_id="query_warehouse" />';

function stubSemanticLayerFetch(compiledSql: string, result: { columns: string[]; data: unknown[] }) {
	const fetchMock = vi.fn(async (url: string, _init: { body: string }) =>
		Response.json(
			url.endsWith('/semantic_layer/compile')
				? { sql: compiledSql, database_id: 'warehouse', dialect: 'duckdb' }
				: result,
		),
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

describe('live story SQL execution', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.getChatInfo.mockResolvedValue({
			projectId: 'project-1',
			userId: 'owner-1',
			title: 'Chat',
		});
		mocks.getChatOwnerId.mockResolvedValue('owner-1');
		mocks.getChatProjectId.mockResolvedValue('project-1');
		mocks.getStoryByChatAndSlug.mockResolvedValue({ id: 'story-1', chatId: 'chat-1' });
		mocks.getStoryById.mockResolvedValue({ id: 'story-standalone', chatId: null });
		mocks.getStoryProjectId.mockResolvedValue('project-1');
		mocks.getStoryOwnerId.mockResolvedValue('owner-1');
		mocks.getUserRoleInProject.mockResolvedValue('admin');
		mocks.getLatestVersionByStoryId.mockResolvedValue(storyVersion('<table query_id="query_admin" />'));
		mocks.listStoryQueries.mockResolvedValue({});
		mocks.getLatestSqlQueriesByIds.mockResolvedValue({});
		mocks.getSqlQueriesByIds.mockResolvedValue({});
		mocks.buildChatlessToolContext.mockImplementation(async () => ({
			projectFolder: '/project',
			projectId: 'project-1',
			userId: 'owner-1',
			chatId: null,
			queryResults: new Map(),
			envVars: {},
			agentSettings: null,
			warehouseTableAccess: { enforced: false, strict: false, tables: [] },
			warehouseRowSecurity: { enforced: false, tables: [] },
		}));
		mocks.buildToolContext.mockImplementation(async () => ({
			projectFolder: '/project',
			projectId: 'project-1',
			userId: 'owner-1',
			chatId: 'chat-1',
			queryResults: new Map(),
			envVars: { TOKEN: 'secret' },
			warehouseAccessToken: 'owner-token',
			agentSettings: null,
			warehouseTableAccess: { enforced: true, strict: true, tables: [] },
			warehouseRowSecurity: {
				enforced: true,
				tables: [
					{
						databaseType: 'duckdb',
						database: 'analytics',
						schema: 'main',
						table: 'orders',
						constraintColumns: ['tenant_id'],
						access: 'predicate',
						predicate: 'tenant_id = 1',
					},
				],
			},
		}));
		mocks.resolveExcludedColumnEnforcement.mockResolvedValue(false);
		mocks.getStoryDataCacheByChatAndSlug.mockResolvedValue(null);
		mocks.getStoryDataCacheByStoryId.mockResolvedValue(null);
		mocks.findMissingQueryIds.mockReturnValue([]);
		mocks.upsertStoryDataCacheByStoryId.mockResolvedValue({});
		mocks.updateVersionCodeIfLatest.mockResolvedValue(true);
		mocks.resolveDefaultModelSelection.mockResolvedValue(null);
		mocks.resolveDefaultChatModel.mockResolvedValue(null);
		mocks.extractCustomStoryQueryIds.mockReturnValue(new Set());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('builds the execution context with the chat owner', async () => {
		await createStoryExecutionContext('chat-1');

		expect(mocks.buildToolContext).toHaveBeenCalledWith({
			projectId: 'project-1',
			userId: 'owner-1',
			chatId: 'chat-1',
			querySource: 'story',
		});
	});

	it('rejects execution when the chat owner is missing', async () => {
		mocks.getChatOwnerId.mockResolvedValue(undefined);

		await expect(createStoryExecutionContext('chat-1')).rejects.toThrow('Chat owner not found');
		expect(mocks.buildToolContext).not.toHaveBeenCalled();
	});

	it('refreshes admin-mode story queries from the app database', async () => {
		mocks.getLatestSqlQueriesByIds.mockResolvedValueOnce({
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
			narratives: {},
			queriesRefreshed: 1,
		});

		expect(mocks.buildToolContext).not.toHaveBeenCalled();
		expect(mocks.upsertStoryDataCacheByStoryId).toHaveBeenCalledWith(
			'story-1',
			{
				query_admin: {
					columns: ['chat_id'],
					data: [{ chat_id: 'chat-1' }],
				},
			},
			undefined,
			{
				query_admin: querySource('SELECT * FROM v_messages', null, true),
			},
		);
	});

	it.each([
		{
			case: 'the pinned live story model',
			pinned: { provider: 'anthropic', modelId: 'claude-pinned' },
			chatDefault: { provider: 'openrouter', modelId: 'openai/gpt-chat' },
			expected: { provider: 'anthropic', modelId: 'claude-pinned' },
		},
		{
			case: 'the default chat model when no live story model is pinned',
			pinned: null,
			chatDefault: { provider: 'openrouter', modelId: 'openai/gpt-chat' },
			expected: { provider: 'openrouter', modelId: 'openai/gpt-chat' },
		},
	])('rewrites a dynamic story with $case', async ({ pinned, chatDefault, expected }) => {
		mocks.getLatestVersionByStoryId.mockResolvedValue({
			code: '<table query_id="query_admin" />',
			title: 'Usage',
			isLiveTextDynamic: true,
			format: 'classic',
		});
		mocks.getLatestSqlQueriesByIds.mockResolvedValue({
			query_admin: { sqlQuery: 'SELECT * FROM v_messages', adminMode: true },
		});
		mocks.queryAppDb.mockResolvedValue({ _version: '1', columns: ['chat_id'], rows: [], rowCount: 0 });
		mocks.resolveDefaultModelSelection.mockResolvedValue(pinned);
		mocks.resolveDefaultChatModel.mockResolvedValue(chatDefault);
		mocks.resolveProviderModel.mockResolvedValue(null);

		await refreshStoryData('chat-1', 'usage');

		expect(mocks.resolveDefaultModelSelection).toHaveBeenCalledWith('project-1', 'live_story');
		expect(mocks.resolveProviderModel).toHaveBeenCalledWith(
			'project-1',
			expected.provider,
			expected.modelId,
			true,
			expect.objectContaining({ chatId: 'chat-1', category: 'story' }),
		);
		expect(mocks.generateText).not.toHaveBeenCalled();
	});

	it('keeps the current text and still caches the fresh data when the model fails to rewrite it', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue({
			id: 'version-1',
			code: '<table query_id="query_admin" />',
			title: 'Usage',
			isLiveTextDynamic: true,
			format: 'classic',
		});
		mocks.getLatestSqlQueriesByIds.mockResolvedValue({
			query_admin: { sqlQuery: 'SELECT * FROM v_messages', adminMode: true },
		});
		mocks.queryAppDb.mockResolvedValue({ _version: '1', columns: ['n'], rows: [{ n: 1 }], rowCount: 1 });
		mocks.resolveDefaultModelSelection.mockResolvedValue({ provider: 'openrouter', modelId: 'some/model' });
		mocks.resolveProviderModel.mockResolvedValue({ model: { modelId: 'some/model' } });
		mocks.generateText.mockRejectedValue(new Error('No object generated: could not parse the response.'));

		await expect(refreshStoryData('chat-1', 'usage')).resolves.toEqual({
			queryData: { query_admin: { columns: ['n'], data: [{ n: 1 }] } },
			narratives: {},
			queriesRefreshed: 1,
		});

		expect(mocks.generateText).toHaveBeenCalledOnce();
		expect(mocks.updateVersionCodeIfLatest).not.toHaveBeenCalled();
		expect(mocks.upsertStoryDataCacheByStoryId).toHaveBeenCalledWith(
			'story-1',
			{ query_admin: { columns: ['n'], data: [{ n: 1 }] } },
			undefined,
			expect.anything(),
		);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('could not parse the response'),
			expect.objectContaining({ projectId: 'project-1' }),
		);
	});

	it('keeps the narratives of the last refresh when the model fails to rewrite a custom story', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue({
			id: 'version-1',
			code: '',
			title: 'Usage',
			isLiveTextDynamic: true,
			format: 'custom',
		});
		mocks.extractCustomStoryQueryIds.mockReturnValue(new Set(['query_admin']));
		mocks.getLatestSqlQueriesByIds.mockResolvedValue({
			query_admin: { sqlQuery: 'SELECT * FROM v_messages', adminMode: true },
		});
		mocks.listVersionFiles.mockResolvedValue([
			{
				path: 'src/App.tsx',
				content: [
					"import { Narrative } from '@nao/story-kit';",
					'export default () => <Narrative id="summary">Usage is flat</Narrative>;',
				].join('\n'),
			},
		]);
		mocks.getStoryDataCacheByStoryId.mockResolvedValue({ analysisResults: { summary: 'Usage grew 12%' } });
		mocks.queryAppDb.mockResolvedValue({ _version: '1', columns: ['n'], rows: [{ n: 1 }], rowCount: 1 });
		mocks.resolveDefaultModelSelection.mockResolvedValue({ provider: 'openrouter', modelId: 'some/model' });
		mocks.resolveProviderModel.mockResolvedValue({ model: { modelId: 'some/model' } });
		mocks.generateText.mockRejectedValue(new Error('No object generated: could not parse the response.'));

		await expect(refreshStoryData('chat-1', 'usage')).resolves.toMatchObject({
			narratives: { summary: 'Usage grew 12%' },
		});

		expect(mocks.generateText).toHaveBeenCalledOnce();
		expect(mocks.upsertStoryDataCacheByStoryId).toHaveBeenCalledWith(
			'story-1',
			{ query_admin: { columns: ['n'], data: [{ n: 1 }] } },
			{ summary: 'Usage grew 12%' },
			expect.anything(),
		);
	});

	it('refreshes a shared live story as its owner and writes the shared cache', async () => {
		const code = WAREHOUSE_STORY_CODE;
		mocks.getLatestVersionByStoryId.mockResolvedValue(storyVersion(code));
		mocks.getLatestSqlQueriesByIds.mockResolvedValueOnce({
			query_warehouse: {
				sqlQuery: 'SELECT * FROM orders',
				databaseId: 'analytics',
				adminMode: false,
			},
		});
		const fetchMock = stubWarehouseFetch({ columns: ['order_id'], data: [{ order_id: 1 }] });

		await expect(getStoryQueryData('chat-1', 'orders', code, true, null)).resolves.toMatchObject({
			queryData: {
				query_warehouse: {
					columns: ['order_id'],
					data: [{ order_id: 1 }],
				},
			},
			code,
		});

		expect(mocks.queryAppDb).not.toHaveBeenCalled();
		expect(assertProjectCloudBillingAccess).toHaveBeenCalledOnce();
		expect(assertProjectCloudBillingAccess).toHaveBeenCalledWith('project-1');
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(mocks.buildToolContext).toHaveBeenCalledWith({
			projectId: 'project-1',
			userId: 'owner-1',
			chatId: 'chat-1',
			querySource: 'story',
		});
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
			user_access_token: 'owner-token',
			table_access: { enforced: true, tables: [] },
			row_security: {
				enforced: true,
				tables: [expect.objectContaining({ table: 'orders', predicate: 'tenant_id = 1' })],
			},
		});
		expect(mocks.upsertStoryDataCacheByStoryId).toHaveBeenCalledWith(
			'story-1',
			{
				query_warehouse: {
					columns: ['order_id'],
					data: [{ order_id: 1 }],
				},
			},
			undefined,
			{
				query_warehouse: querySource('SELECT * FROM orders', 'analytics'),
			},
		);
	});

	it('refreshes a local query in DuckDB after re-running the warehouse query it reads from', async () => {
		const code = '<chart query_id="query_local" />';
		mocks.getLatestVersionByStoryId.mockResolvedValue(storyVersion(code));
		mocks.getLatestSqlQueriesByIds.mockResolvedValueOnce({
			query_local: {
				sqlQuery: 'SELECT region, sum(amount) AS total FROM query_upstream GROUP BY region',
				databaseId: 'duckdb_local',
				adminMode: false,
			},
		});
		mocks.getLatestSqlQueriesByIds.mockResolvedValueOnce({
			query_upstream: {
				sqlQuery: 'SELECT * FROM orders',
				databaseId: 'analytics',
				adminMode: false,
			},
		});
		const fetchMock = stubWarehouseFetch({ columns: ['region', 'amount'], data: [{ region: 'EU', amount: 10 }] });
		mocks.runQueryOnLocalFiles.mockImplementation(
			async (_sql: string, context: { queryResults: Map<string, unknown> }) => ({
				result: {
					columns: ['region', 'total'],
					data: [{ region: 'EU', total: 10, upstream_seen: context.queryResults.has('query_upstream') }],
				},
			}),
		);

		await expect(refreshStoryData('chat-1', 'sales')).resolves.toEqual({
			queryData: {
				query_local: {
					columns: ['region', 'total'],
					data: [{ region: 'EU', total: 10, upstream_seen: true }],
				},
			},
			narratives: {},
			queriesRefreshed: 1,
		});

		expect(mocks.getLatestSqlQueriesByIds).toHaveBeenCalledWith('chat-1', new Set(['query_upstream']));
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
			sql: 'SELECT * FROM orders',
			database_id: 'analytics',
		});
		expect(mocks.runQueryOnLocalFiles).toHaveBeenCalledWith(
			'SELECT region, sum(amount) AS total FROM query_upstream GROUP BY region',
			expect.objectContaining({ chatId: 'chat-1' }),
		);
	});

	it('compiles a semantic story query again so the current metric definitions apply', async () => {
		const code = '<chart query_id="query_revenue" />';
		mocks.getLatestVersionByStoryId.mockResolvedValue({ code, isLiveTextDynamic: false, format: 'classic' });
		mocks.getLatestSqlQueriesByIds.mockResolvedValueOnce({
			query_revenue: {
				sqlQuery: 'SELECT sum(amount) AS revenue FROM orders',
				databaseId: 'analytics',
				adminMode: false,
				semanticQuery: { metrics: ['revenue'], group_by: ['metric_time__month'] },
			},
		});
		const fetchMock = stubSemanticLayerFetch('SELECT sum(amount - refunds) AS revenue FROM orders', {
			columns: ['revenue'],
			data: [{ revenue: 90 }],
		});

		await expect(refreshStoryData('chat-1', 'revenue')).resolves.toEqual({
			queryData: { query_revenue: { columns: ['revenue'], data: [{ revenue: 90 }] } },
			narratives: {},
			queriesRefreshed: 1,
		});

		const [compileCall, executeCall] = fetchMock.mock.calls;
		expect(compileCall[0]).toContain('/semantic_layer/compile');
		expect(JSON.parse(compileCall[1].body)).toMatchObject({
			metrics: ['revenue'],
			group_by: ['metric_time__month'],
			nao_project_folder: '/project',
			env_vars: { TOKEN: 'secret' },
		});
		expect(JSON.parse(executeCall[1].body)).toMatchObject({
			sql: 'SELECT sum(amount - refunds) AS revenue FROM orders',
			database_id: 'warehouse',
		});
	});

	it('refreshes a parameterized semantic story query with the story parameter default', async () => {
		const code = [
			`<parameter id="metric" type="metric" options='["revenue","orders"]' default="orders" />`,
			'<chart query_id="query_metric" />',
		].join('\n');
		mocks.getLatestVersionByStoryId.mockResolvedValue({ code, isLiveTextDynamic: false, format: 'classic' });
		mocks.getLatestSqlQueriesByIds.mockResolvedValueOnce({
			query_metric: {
				sqlQuery: 'SELECT 1',
				databaseId: 'analytics',
				adminMode: false,
				semanticQuery: {
					metrics: ['{{ params.metric }}'],
					group_by: ['metric_time__{{ params.grain }}'],
					params: { metric: 'revenue', grain: 'week' },
				},
			},
		});
		const fetchMock = stubSemanticLayerFetch('SELECT 2', { columns: ['orders'], data: [{ orders: 3 }] });

		await refreshStoryData('chat-1', 'metric');

		const compileBody = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(compileBody).toMatchObject({ metrics: ['orders'], group_by: ['metric_time__week'] });
		expect(compileBody).not.toHaveProperty('params');
	});

	it('compiles a semantic live query again before running it', async () => {
		mocks.getSqlQueryById.mockResolvedValue({
			sqlQuery: 'SELECT count(*) AS orders FROM orders',
			databaseId: 'analytics',
			adminMode: false,
			semanticQuery: { metrics: ['orders'] },
		});
		const fetchMock = stubSemanticLayerFetch('SELECT count(DISTINCT order_id) AS orders FROM orders', {
			columns: ['orders'],
			data: [{ orders: 3 }],
		});

		await expect(executeLiveQuery('chat-1', 'query_orders')).resolves.toEqual({
			columns: ['orders'],
			data: [{ orders: 3 }],
		});
		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
			sql: 'SELECT count(DISTINCT order_id) AS orders FROM orders',
		});
	});

	it('runs a no-cache live query with the story parameter default', async () => {
		mocks.getSqlQueryById.mockResolvedValue({
			sqlQuery: 'SELECT 1',
			databaseId: 'analytics',
			adminMode: false,
			semanticQuery: { metrics: ['{{ params.metric }}'], params: { metric: 'revenue' } },
		});
		const fetchMock = stubSemanticLayerFetch('SELECT 2', { columns: ['orders'], data: [{ orders: 3 }] });

		await executeLiveQuery('chat-1', 'query_metric', {
			storyCode: `<parameter id="metric" options='["revenue","orders"]' default="orders" />`,
		});

		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ metrics: ['orders'] });
	});

	it('never sends a local live query to the warehouse', async () => {
		mocks.getSqlQueryById.mockResolvedValue({
			sqlQuery: 'SELECT * FROM query_upstream',
			databaseId: 'duckdb_local',
			adminMode: false,
		});
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		mocks.runQueryOnLocalFiles.mockResolvedValue({
			result: { columns: ['id'], data: [{ id: 1 }] },
		});

		await expect(executeLiveQuery('chat-1', 'query_local')).resolves.toEqual({
			columns: ['id'],
			data: [{ id: 1 }],
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns non-live stored data regardless of row security', async () => {
		const code = WAREHOUSE_STORY_CODE;
		const queryData = {
			query_warehouse: {
				columns: ['region'],
				data: [{ region: 'all-regions' }],
			},
		};
		mocks.getQueryDataFromCode.mockResolvedValue(queryData);

		await expect(getStoryQueryData('chat-1', 'orders', code, false, null)).resolves.toEqual({
			queryData,
			cachedAt: null,
			code,
			allowsPersistedFallback: true,
		});

		expect(mocks.getQueryDataFromCode).toHaveBeenCalledWith('chat-1', code);
		expect(mocks.buildToolContext).not.toHaveBeenCalled();
	});

	it('serves a fresh shared cache without building an execution context', async () => {
		const code = WAREHOUSE_STORY_CODE;
		const cache = {
			queryData: {
				query_warehouse: {
					columns: ['owner'],
					data: [{ owner: 'owner-1' }],
				},
			},
			querySources: {
				query_warehouse: querySource('SELECT * FROM orders', 'analytics'),
			},
			cachedAt: new Date(),
		};
		mocks.getStoryDataCacheByChatAndSlug.mockResolvedValue(cache);

		await expect(getStoryQueryData('chat-1', 'orders', code, true, null)).resolves.toEqual({
			queryData: cache.queryData,
			cachedAt: cache.cachedAt,
			code,
		});
		expect(mocks.buildToolContext).not.toHaveBeenCalled();
	});

	it('backfills missing data in a fresh legacy cache', async () => {
		const code = WAREHOUSE_STORY_CODE;
		const cachedAt = new Date();
		const backfilled = {
			query_warehouse: {
				columns: ['id'],
				data: [{ id: 2 }],
			},
		};
		mocks.getStoryDataCacheByChatAndSlug.mockResolvedValue({
			queryData: {},
			querySources: null,
			cachedAt,
		});
		mocks.findMissingQueryIds.mockReturnValue(['query_warehouse']);
		mocks.backfillMissingQueryData.mockResolvedValue(backfilled);

		await expect(getStoryQueryData('chat-1', 'orders', code, true, null)).resolves.toEqual({
			queryData: backfilled,
			cachedAt,
			code,
		});
		expect(mocks.backfillMissingQueryData).toHaveBeenCalledWith(code, {}, { chatId: 'chat-1' });
	});

	it('falls back to an expired cache when owner refresh fails', async () => {
		const code = WAREHOUSE_STORY_CODE;
		const cache = expiredCache();
		mocks.getStoryDataCacheByChatAndSlug.mockResolvedValue(cache);
		mocks.getLatestVersionByStoryId.mockRejectedValue(new Error('Warehouse unavailable'));

		await expect(getStoryQueryData('chat-1', 'orders', code, true, '* * * * *')).resolves.toEqual({
			queryData: cache.queryData,
			cachedAt: cache.cachedAt,
			code,
		});
	});

	it('does not run warehouse SQL when cloud billing access is restricted', async () => {
		vi.mocked(assertProjectCloudBillingAccess).mockRejectedValueOnce(new Error('restricted'));
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const executionContext = await createStoryExecutionContext('chat-1');

		await expect(executeRawSql('SELECT * FROM orders', { executionContext })).rejects.toThrow('restricted');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('does not build the story execution context when cloud billing access is restricted', async () => {
		mocks.getLatestSqlQueriesByIds.mockResolvedValueOnce({
			query_warehouse: {
				sqlQuery: 'SELECT * FROM orders',
				databaseId: 'analytics',
				adminMode: false,
			},
		});
		vi.mocked(assertProjectCloudBillingAccess).mockRejectedValueOnce(new Error('restricted'));

		await expect(refreshStoryData('chat-1', 'orders')).rejects.toThrow('restricted');
		expect(mocks.buildToolContext).not.toHaveBeenCalled();
	});

	it('serves an expired cache without refreshing when the refresh is deferred', async () => {
		const code = WAREHOUSE_STORY_CODE;
		const cache = expiredCache();
		mocks.getStoryDataCacheByChatAndSlug.mockResolvedValue(cache);

		await expect(
			getStoryQueryData('chat-1', 'orders', code, true, '* * * * *', { deferRefresh: true }),
		).resolves.toEqual({
			queryData: cache.queryData,
			cachedAt: cache.cachedAt,
			code,
			needsRefresh: true,
		});
		expect(mocks.getLatestVersionByStoryId).not.toHaveBeenCalled();
	});

	it('serves the chat data of a never-cached story and leaves its first refresh to the caller', async () => {
		const code = WAREHOUSE_STORY_CODE;
		const queryData = {
			query_warehouse: {
				columns: ['id'],
				data: [{ id: 1 }],
			},
		};
		mocks.getStoryDataCacheByChatAndSlug.mockResolvedValue(null);
		mocks.getQueryDataFromCode.mockResolvedValue(queryData);

		await expect(
			getStoryQueryData('chat-1', 'orders', code, true, null, { deferFirstRefresh: true }),
		).resolves.toEqual({
			queryData,
			cachedAt: null,
			code,
			needsRefresh: true,
		});
		expect(mocks.getLatestVersionByStoryId).not.toHaveBeenCalled();
	});

	it.each([
		['the refresh after a failure', { deferRefresh: true }],
		['the first refresh', { deferFirstRefresh: true }],
	])('does not defer %s of a story without queries', async (_case, options) => {
		const code = '# Just a title';
		mocks.getStoryDataCacheByChatAndSlug.mockResolvedValue(null);
		mocks.getLatestVersionByStoryId.mockResolvedValue(storyVersion(code));
		mocks.getLatestSqlQueriesByIds.mockResolvedValueOnce({});

		await expect(getStoryQueryData('chat-1', 'orders', code, true, null, options)).resolves.toEqual({
			queryData: null,
			cachedAt: expect.any(Date),
			code,
		});
		expect(mocks.getLatestVersionByStoryId).toHaveBeenCalled();
	});

	it('still refreshes an expired cache inline when only the first refresh is deferred', async () => {
		const code = WAREHOUSE_STORY_CODE;
		mocks.getStoryDataCacheByChatAndSlug.mockResolvedValue(expiredCache());
		mocks.getLatestVersionByStoryId.mockResolvedValue(storyVersion(code));
		mocks.getLatestSqlQueriesByIds.mockResolvedValueOnce({});

		const result = await getStoryQueryData('chat-1', 'orders', code, true, '* * * * *', {
			deferFirstRefresh: true,
		});

		expect(result.needsRefresh).toBeUndefined();
		expect(mocks.getLatestVersionByStoryId).toHaveBeenCalled();
	});

	it('falls back to stored data when refresh fails without a cache', async () => {
		const code = WAREHOUSE_STORY_CODE;
		const queryData = {
			query_warehouse: {
				columns: ['id'],
				data: [{ id: 1 }],
			},
		};
		mocks.getLatestVersionByStoryId.mockRejectedValue(new Error('Warehouse unavailable'));
		mocks.getQueryDataFromCode.mockResolvedValue(queryData);

		await expect(getStoryQueryData('chat-1', 'orders', code, true, null)).resolves.toEqual({
			queryData,
			cachedAt: null,
			code,
		});
	});

	it('uses the app database for a single admin-mode live query', async () => {
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
		expect(mocks.buildToolContext).not.toHaveBeenCalled();
	});

	it('refreshes a standalone story from the SQL saved with it, as its owner and without a chat', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue(storyVersion(WAREHOUSE_STORY_CODE));
		mocks.listStoryQueries.mockResolvedValue({
			query_warehouse: { sqlQuery: 'SELECT * FROM orders', databaseId: 'analytics', adminMode: false },
		});
		const fetchMock = stubWarehouseFetch({ columns: ['order_id'], data: [{ order_id: 1 }] });

		await expect(refreshStoryById('story-standalone')).resolves.toEqual({
			queryData: { query_warehouse: { columns: ['order_id'], data: [{ order_id: 1 }] } },
			narratives: {},
			queriesRefreshed: 1,
		});

		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ sql: 'SELECT * FROM orders' });
		expect(mocks.buildChatlessToolContext).toHaveBeenCalledWith({
			projectId: 'project-1',
			userId: 'owner-1',
			querySource: 'story',
		});
		expect(mocks.buildToolContext).not.toHaveBeenCalled();
		expect(mocks.getLatestSqlQueriesByIds).not.toHaveBeenCalled();
		expect(mocks.upsertStoryDataCacheByStoryId).toHaveBeenCalledWith(
			'story-standalone',
			{ query_warehouse: { columns: ['order_id'], data: [{ order_id: 1 }] } },
			undefined,
			{ query_warehouse: querySource('SELECT * FROM orders', 'analytics') },
		);
	});

	it('runs the SQL of a chat story from its chat and reads only the queries the chat lacks from the story', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue(
			storyVersion('<table query_id="query_saved" />\n<table query_id="query_chat" />'),
		);
		mocks.getLatestSqlQueriesByIds.mockResolvedValue({
			query_chat: { sqlQuery: 'SELECT edited_in_chat', databaseId: 'analytics', adminMode: false },
		});
		mocks.listStoryQueries.mockResolvedValue({
			query_saved: { sqlQuery: 'SELECT saved', databaseId: 'analytics', adminMode: false },
		});
		const fetchMock = stubWarehouseFetch({ columns: ['id'], data: [{ id: 1 }] });

		await refreshStoryData('chat-1', 'orders');

		expect(mocks.listStoryQueries).toHaveBeenCalledWith(expect.any(String), new Set(['query_saved']));
		const sentSql = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).sql);
		expect(sentSql.sort()).toEqual(['SELECT edited_in_chat', 'SELECT saved']);
	});

	it('drops the cached rows of the queries a chat story no longer uses', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue(storyVersion('<table query_id="query_current" />'));
		mocks.getLatestSqlQueriesByIds.mockResolvedValue({
			query_current: { sqlQuery: 'SELECT current', databaseId: 'analytics', adminMode: false },
		});
		mocks.getStoryDataCacheByStoryId.mockResolvedValue({
			queryData: { query_removed: { columns: ['secret'], data: [{ secret: 1 }] } },
		});
		const freshRows = { columns: ['id'], data: [{ id: 1 }] };
		stubWarehouseFetch(freshRows);

		const { queryData } = await refreshStoryData('chat-1', 'orders');

		expect(queryData).toEqual({ query_current: freshRows });
		expect(mocks.upsertStoryDataCacheByStoryId).toHaveBeenCalledWith(
			expect.any(String),
			{ query_current: freshRows },
			undefined,
			expect.anything(),
		);
	});

	it('leaves the cache untouched when none of the queries of a story could run', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('user');
		mocks.getLatestVersionByStoryId.mockResolvedValue(storyVersion('<table query_id="query_admin" />'));
		mocks.listStoryQueries.mockResolvedValue({
			query_admin: { sqlQuery: 'SELECT * FROM v_messages', adminMode: true },
		});

		await expect(refreshStoryById('story-standalone')).resolves.toMatchObject({ queriesRefreshed: 0 });

		expect(mocks.queryAppDb).not.toHaveBeenCalled();
		expect(mocks.upsertStoryDataCacheByStoryId).not.toHaveBeenCalled();
	});

	it('keeps the cached rows of an app database query when the story owner is not a project admin', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('user');
		mocks.getLatestVersionByStoryId.mockResolvedValue(
			storyVersion('<table query_id="query_admin" />\n<table query_id="query_warehouse" />'),
		);
		mocks.listStoryQueries.mockResolvedValue({
			query_admin: { sqlQuery: 'SELECT * FROM v_messages', adminMode: true },
			query_warehouse: { sqlQuery: 'SELECT * FROM orders', databaseId: 'analytics', adminMode: false },
		});
		const cachedAdminRows = { columns: ['chat_id'], data: [{ chat_id: 'cached' }] };
		mocks.getStoryDataCacheByStoryId.mockResolvedValue({ queryData: { query_admin: cachedAdminRows } });
		stubWarehouseFetch({ columns: ['order_id'], data: [{ order_id: 1 }] });

		await expect(refreshStoryById('story-standalone')).resolves.toMatchObject({
			queryData: {
				query_admin: cachedAdminRows,
				query_warehouse: { columns: ['order_id'], data: [{ order_id: 1 }] },
			},
		});

		expect(mocks.queryAppDb).not.toHaveBeenCalled();
		expect(mocks.upsertStoryDataCacheByStoryId).toHaveBeenCalledWith(
			'story-standalone',
			expect.anything(),
			undefined,
			{ query_warehouse: querySource('SELECT * FROM orders', 'analytics') },
		);
	});

	it('keeps the cached rows that only older versions of a standalone story read', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue(storyVersion(WAREHOUSE_STORY_CODE));
		mocks.listStoryQueries.mockResolvedValue({
			query_warehouse: { sqlQuery: 'SELECT * FROM orders', databaseId: 'analytics', adminMode: false },
		});
		const olderVersionRows = { columns: ['month'], data: [{ month: 'Jan' }] };
		mocks.getStoryDataCacheByStoryId.mockResolvedValue({ queryData: { query_older: olderVersionRows } });
		stubWarehouseFetch({ columns: ['order_id'], data: [{ order_id: 1 }] });

		await refreshStoryById('story-standalone');

		expect(mocks.upsertStoryDataCacheByStoryId).toHaveBeenCalledWith(
			'story-standalone',
			{ query_older: olderVersionRows, query_warehouse: { columns: ['order_id'], data: [{ order_id: 1 }] } },
			undefined,
			expect.anything(),
		);
	});

	it('keeps showing the saved rows of a standalone story that has no SQL to rerun', async () => {
		const savedRows = { columns: ['order_id'], data: [{ order_id: 7 }] };
		mocks.getLatestVersionByStoryId.mockResolvedValue(storyVersion(WAREHOUSE_STORY_CODE));
		mocks.getStoryDataCacheByStoryId.mockResolvedValue({ queryData: { query_warehouse: savedRows } });

		await expect(refreshStoryById('story-standalone')).resolves.toEqual({
			queryData: { query_warehouse: savedRows },
			narratives: {},
			queriesRefreshed: 0,
		});
		expect(mocks.upsertStoryDataCacheByStoryId).not.toHaveBeenCalled();
	});

	it('keeps the cached rows of a local query reading an app database query its owner cannot run', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('user');
		mocks.getLatestVersionByStoryId.mockResolvedValue(
			storyVersion('<chart query_id="query_local" />\n<table query_id="query_warehouse" />'),
		);
		mocks.listStoryQueries.mockResolvedValueOnce({
			query_local: { sqlQuery: 'SELECT count(*) FROM query_admin', databaseId: 'duckdb_local', adminMode: false },
			query_warehouse: { sqlQuery: 'SELECT * FROM orders', databaseId: 'analytics', adminMode: false },
		});
		mocks.listStoryQueries.mockResolvedValueOnce({
			query_admin: { sqlQuery: 'SELECT * FROM v_messages', adminMode: true },
		});
		const cachedLocalRows = { columns: ['count'], data: [{ count: 3 }] };
		mocks.getStoryDataCacheByStoryId.mockResolvedValue({ queryData: { query_local: cachedLocalRows } });
		stubWarehouseFetch({ columns: ['order_id'], data: [{ order_id: 1 }] });

		await expect(refreshStoryById('story-standalone')).resolves.toMatchObject({
			queryData: { query_local: cachedLocalRows, query_warehouse: { data: [{ order_id: 1 }] } },
			queriesRefreshed: 1,
		});
		expect(mocks.runQueryOnLocalFiles).not.toHaveBeenCalled();
		expect(mocks.queryAppDb).not.toHaveBeenCalled();
	});

	it('serves the saved rows of a single app database query when the chat owner is not a project admin', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('user');
		mocks.getSqlQueryById.mockResolvedValue({ sqlQuery: 'SELECT chat_id FROM v_messages', adminMode: true });
		const savedRows = { columns: ['chat_id'], data: [{ chat_id: 'saved' }] };
		mocks.getLatestSqlQueryDataByIds.mockResolvedValue({ query_admin: savedRows });

		await expect(executeLiveQuery('chat-1', 'query_admin')).resolves.toEqual(savedRows);
		expect(mocks.queryAppDb).not.toHaveBeenCalled();
	});

	it.each([
		{ case: 'reads no query', code: '# Notes', savedQueries: {}, expected: false },
		{ case: 'has no SQL for its queries', code: WAREHOUSE_STORY_CODE, savedQueries: {}, expected: true },
		{
			case: 'has SQL for its queries',
			code: WAREHOUSE_STORY_CODE,
			savedQueries: { query_warehouse: { sqlQuery: 'SELECT 1', adminMode: false } },
			expected: false,
		},
	])(
		'tells a standalone story that $case whether it only has frozen queries',
		async ({ code, savedQueries, expected }) => {
			mocks.getLatestVersionByStoryId.mockResolvedValue(storyVersion(code));
			mocks.listStoryQueries.mockResolvedValue(savedQueries);

			await expect(hasOnlyFrozenQueries({ id: 'story-standalone', chatId: null })).resolves.toBe(expected);
		},
	);

	it('shows the saved rows of a standalone query that has no SQL to rerun', async () => {
		const savedRows = { columns: ['order_id'], data: [{ order_id: 7 }] };
		mocks.getStoryDataCacheByStoryId.mockResolvedValue({ queryData: { query_frozen: savedRows } });

		await expect(executeStoryLiveQuery({ id: 'story-standalone', chatId: null }, 'query_frozen')).resolves.toEqual(
			savedRows,
		);
	});
});

function querySource(sql: string, databaseId: string | null = null, adminMode = false) {
	return {
		fingerprint: createHash('sha256').update(JSON.stringify({ sql, databaseId, adminMode })).digest('hex'),
		databaseId,
		adminMode,
	};
}

function storyVersion(code: string) {
	return { code, isLiveTextDynamic: false, format: 'classic' };
}

function expiredCache() {
	return {
		queryData: { query_warehouse: { columns: ['id'], data: [{ id: 1 }] } },
		querySources: null,
		cachedAt: new Date(0),
	};
}

function stubWarehouseFetch(response: { columns: string[]; data: unknown[] }) {
	const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(response) });
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}
