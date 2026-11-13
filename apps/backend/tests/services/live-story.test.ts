import { createHash } from 'node:crypto';

import { STORY_NARRATIVES_REDACT_MISSING_KEY, STORY_VIEWER_RESTRICTED_CODE_MARKER } from '@nao/shared/story-app';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getChatInfo: vi.fn(),
	getChatOwnerId: vi.fn(),
	getChatProjectId: vi.fn(),
	getLatestVersionByChatAndSlug: vi.fn(),
	getVersionById: vi.fn(),
	getSqlQueriesFromCode: vi.fn(),
	getSqlQueriesByIds: vi.fn(),
	getSqlQueryById: vi.fn(),
	getLatestSqlQueriesByIds: vi.fn(),
	listVersionFiles: vi.fn(),
	getStoryDataCacheByChatAndSlug: vi.fn(),
	getStoryViewerDataCache: vi.fn(),
	getProjectViewerCacheRevision: vi.fn(),
	getStoryViewerCacheRevision: vi.fn(),
	getQueryDataFromCode: vi.fn(),
	getProjectRowSecurity: vi.fn(),
	queryAppDb: vi.fn(),
	runQueryOnLocalFiles: vi.fn(),
	buildToolContext: vi.fn(),
	hasEffectiveWarehouseRestrictions: vi.fn(),
	resolveExcludedColumnEnforcement: vi.fn(),
	upsertStoryDataCache: vi.fn(),
	upsertStoryViewerDataCache: vi.fn(),
	updateLatestVersionCode: vi.fn(),
	findMissingQueryIds: vi.fn(),
	backfillMissingQueryData: vi.fn(),
	extractCustomStoryQueryIds: vi.fn(),
	generateText: vi.fn(),
	getProjectModelProvider: vi.fn(),
	resolveDefaultModelSelection: vi.fn(),
	resolveProviderModel: vi.fn(),
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

vi.mock('../../src/queries/project-llm-config.queries', () => ({
	getProjectModelProvider: mocks.getProjectModelProvider,
}));

vi.mock('../../src/queries/story.queries', () => ({
	getLatestVersionByChatAndSlug: mocks.getLatestVersionByChatAndSlug,
	getVersionById: mocks.getVersionById,
	getSqlQueriesFromCode: mocks.getSqlQueriesFromCode,
	getSqlQueriesByIds: mocks.getSqlQueriesByIds,
	getSqlQueryById: mocks.getSqlQueryById,
	getStoryDataCacheByChatAndSlug: mocks.getStoryDataCacheByChatAndSlug,
	getStoryViewerDataCache: mocks.getStoryViewerDataCache,
	getProjectViewerCacheRevision: mocks.getProjectViewerCacheRevision,
	getStoryViewerCacheRevision: mocks.getStoryViewerCacheRevision,
	upsertStoryDataCache: mocks.upsertStoryDataCache,
	upsertStoryViewerDataCache: mocks.upsertStoryViewerDataCache,
	updateLatestVersionCode: mocks.updateLatestVersionCode,
}));

vi.mock('../../src/queries/shared-story.queries', () => ({
	getQueryDataFromCode: mocks.getQueryDataFromCode,
}));

vi.mock('../../src/queries/execute-sql.queries', () => ({
	getLatestSqlQueriesByIds: mocks.getLatestSqlQueriesByIds,
}));

vi.mock('../../src/queries/story-file.queries', () => ({
	listVersionFiles: mocks.listVersionFiles,
}));

vi.mock('../../src/queries/user-group.queries', () => ({
	getProjectRowSecurity: mocks.getProjectRowSecurity,
}));

vi.mock('../../src/services/agent', () => ({
	buildToolContext: mocks.buildToolContext,
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

vi.mock('../../src/services/user-group-context-access.service', () => ({
	hasEffectiveWarehouseRestrictions: mocks.hasEffectiveWarehouseRestrictions,
}));

vi.mock('../../src/utils/llm', () => ({
	getDefaultModelId: vi.fn(),
	resolveDefaultModelSelection: mocks.resolveDefaultModelSelection,
	resolveProviderModel: mocks.resolveProviderModel,
}));

vi.mock('../../src/utils/schedule-task', () => ({
	scheduleSaveLlmInferenceRecord: vi.fn(),
}));

vi.mock('../../src/utils/story-query-data', () => ({
	backfillMissingQueryData: mocks.backfillMissingQueryData,
	findMissingQueryIds: mocks.findMissingQueryIds,
	extractCustomStoryQueryIds: mocks.extractCustomStoryQueryIds,
}));

import { assertProjectCloudBillingAccess } from '../../src/services/cloud-billing-access.service';
import {
	createStoryExecutionContext,
	executeLiveQuery,
	executeRawSql,
	getStoryQueryData,
	refreshStoryData,
	refreshStoryDataForDelivery,
} from '../../src/services/live-story';

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

function toolContext(rowPredicate = 'tenant_id = 1') {
	return {
		projectFolder: '/project',
		projectId: 'project-1',
		userId: 'owner-1',
		chatId: 'chat-1',
		queryResults: new Map(),
		envVars: { TOKEN: 'secret' },
		azureAccessToken: 'owner-token',
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
					predicate: rowPredicate,
				},
			],
		},
	};
}

const VIEWER_PERMISSION_REVISION = createHash('sha256')
	.update(JSON.stringify([toolContext().warehouseTableAccess, toolContext().warehouseRowSecurity, false, 0]))
	.digest('hex');

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
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue(storyVersion('<table query_id="query_admin" />'));
		mocks.getSqlQueriesByIds.mockResolvedValue({});
		mocks.extractCustomStoryQueryIds.mockReturnValue(new Set());
		mocks.listVersionFiles.mockResolvedValue([]);
		mocks.buildToolContext.mockImplementation(async () => toolContext());
		mocks.resolveExcludedColumnEnforcement.mockResolvedValue(false);
		mocks.getStoryDataCacheByChatAndSlug.mockResolvedValue(null);
		mocks.getStoryViewerDataCache.mockResolvedValue(null);
		mocks.getProjectViewerCacheRevision.mockResolvedValue(0);
		mocks.getStoryViewerCacheRevision.mockResolvedValue(0);
		mocks.getProjectRowSecurity.mockResolvedValue({ version: 1, tables: [] });
		mocks.hasEffectiveWarehouseRestrictions.mockImplementation(
			async () => (await mocks.getProjectRowSecurity()).tables.length > 0,
		);
		mocks.findMissingQueryIds.mockReturnValue([]);
		mocks.upsertStoryDataCache.mockResolvedValue({});
		mocks.upsertStoryViewerDataCache.mockResolvedValue(true);
		mocks.updateLatestVersionCode.mockResolvedValue(undefined);
		mocks.resolveDefaultModelSelection.mockResolvedValue(null);
		mocks.getProjectModelProvider.mockResolvedValue(null);
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
		});
	});

	it('rejects an execution context built across a cache revision change', async () => {
		mocks.getProjectViewerCacheRevision.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

		await expect(createStoryExecutionContext('chat-1', 'viewer-1')).rejects.toThrow(
			'Viewer permissions changed while building the execution context',
		);
	});

	it('runs a live query with the viewer context when row security is enabled', async () => {
		mocks.getProjectRowSecurity.mockResolvedValue({
			version: 1,
			tables: [{ databaseType: 'duckdb', database: 'analytics', schema: 'main', table: 'orders' }],
		});
		mocks.getSqlQueryById.mockResolvedValue({
			sqlQuery: 'SELECT * FROM query_orders',
			databaseId: 'duckdb_local',
			adminMode: false,
		});
		mocks.runQueryOnLocalFiles.mockResolvedValue({
			result: { columns: ['id'], data: [{ id: 1 }] },
		});

		await executeLiveQuery('chat-1', 'query_local', { viewerUserId: 'viewer-1' });

		expect(mocks.buildToolContext).toHaveBeenCalledWith({
			projectId: 'project-1',
			userId: 'viewer-1',
			chatId: 'chat-1',
		});
	});

	it('rejects execution when the chat owner is missing', async () => {
		mocks.getChatOwnerId.mockResolvedValue(undefined);

		await expect(createStoryExecutionContext('chat-1')).rejects.toThrow('Chat owner not found');
		expect(mocks.buildToolContext).not.toHaveBeenCalled();
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
			narratives: {},
		});

		expect(mocks.buildToolContext).not.toHaveBeenCalled();
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
			{},
		);
	});

	it('refreshes a shared live story as its owner and writes the shared cache', async () => {
		const code = WAREHOUSE_STORY_CODE;
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue(storyVersion(code));
		mocks.getSqlQueriesFromCode.mockResolvedValue({
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
		});
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
			azure_access_token: 'owner-token',
			table_access: { enforced: true, tables: [] },
			row_security: {
				enforced: true,
				tables: [expect.objectContaining({ table: 'orders', predicate: 'tenant_id = 1' })],
			},
		});
		expect(mocks.upsertStoryDataCache).toHaveBeenCalledWith(
			'chat-1',
			'orders',
			{
				query_warehouse: {
					columns: ['order_id'],
					data: [{ order_id: 1 }],
				},
			},
			{
				query_warehouse: querySource('SELECT * FROM orders', 'analytics'),
			},
			{},
		);
	});

	it('fails an owner refresh when the warehouse denies table access', async () => {
		const code = '<table query_id="query_orders" />\n<table query_id="query_customers" />';
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			code,
			isLiveTextDynamic: false,
			format: 'classic',
		});
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_orders: {
				sqlQuery: 'SELECT count(*) AS order_count FROM orders',
				databaseId: 'analytics',
				adminMode: false,
			},
			query_customers: {
				sqlQuery: 'SELECT first_name FROM customers',
				databaseId: 'analytics',
				adminMode: false,
			},
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init: { body: string }) => {
				const { sql } = JSON.parse(init.body) as { sql: string };
				return sql.includes('customers')
					? Response.json({ detail: 'Query blocked by Context table permissions.' }, { status: 403 })
					: Response.json({ columns: ['order_count'], data: [{ order_count: 99 }], row_count: 1 });
			}),
		);

		await expect(refreshStoryData('chat-1', 'orders')).rejects.toThrow(
			'Warehouse SQL request denied: Query blocked by Context table permissions.',
		);
		expect(mocks.upsertStoryDataCache).not.toHaveBeenCalled();
	});

	it('refreshes a local query in DuckDB after re-running the warehouse query it reads from', async () => {
		const code = '<chart query_id="query_local" />';
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue(storyVersion(code));
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_local: {
				sqlQuery: 'SELECT region, sum(amount) AS total FROM query_upstream GROUP BY region',
				databaseId: 'duckdb_local',
				adminMode: false,
			},
		});
		mocks.getSqlQueriesByIds.mockResolvedValue({
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
		});

		expect(mocks.getSqlQueriesByIds).toHaveBeenCalledWith('chat-1', new Set(['query_upstream']));
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

	it('propagates denied upstream access without running dependent local queries', async () => {
		const code = '<chart query_id="query_local" />\n<chart query_id="query_allowed" />';
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ code, isLiveTextDynamic: false, format: 'classic' });
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_local: {
				sqlQuery: 'SELECT count(*) AS customer_count FROM query_customers',
				databaseId: 'duckdb_local',
				adminMode: false,
			},
			query_allowed: {
				sqlQuery: 'SELECT count(*) AS order_count FROM orders',
				databaseId: 'analytics',
				adminMode: false,
			},
		});
		mocks.getSqlQueriesByIds.mockResolvedValue({
			query_customers: {
				sqlQuery: 'SELECT * FROM customers',
				databaseId: 'analytics',
				adminMode: false,
			},
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init: { body: string }) => {
				const { sql } = JSON.parse(init.body) as { sql: string };
				return sql.includes('customers')
					? Response.json({ detail: 'Query blocked by Context table permissions.' }, { status: 403 })
					: Response.json({ columns: ['order_count'], data: [{ order_count: 99 }], row_count: 1 });
			}),
		);

		await expect(refreshStoryData('chat-1', 'sales', { viewerUserId: 'viewer-1' })).resolves.toEqual({
			queryData: {
				query_allowed: {
					columns: ['order_count'],
					data: [{ order_count: 99 }],
				},
			},
			narratives: {},
		});

		expect(mocks.runQueryOnLocalFiles).not.toHaveBeenCalled();
		expect(mocks.upsertStoryViewerDataCache.mock.calls[0]![7]).toEqual({
			query_local: { columns: [], data: [], accessDenied: true },
			query_allowed: {
				columns: ['order_count'],
				data: [{ order_count: 99 }],
			},
		});
		expect(mocks.upsertStoryDataCache).not.toHaveBeenCalled();
	});

	it('compiles a semantic story query again so the current metric definitions apply', async () => {
		const code = '<chart query_id="query_revenue" />';
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ code, isLiveTextDynamic: false, format: 'classic' });
		mocks.getSqlQueriesFromCode.mockResolvedValue({
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
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ code, isLiveTextDynamic: false, format: 'classic' });
		mocks.getSqlQueriesFromCode.mockResolvedValue({
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

	it('returns non-live stored data when no viewer is provided', async () => {
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

	it('returns stored data to a viewer with full access to every RLS table', async () => {
		const code = '<table query_id="query_warehouse" />';
		const queryData = {
			query_warehouse: {
				columns: ['region'],
				data: [{ region: 'all-regions' }],
			},
		};
		mocks.getProjectRowSecurity.mockResolvedValue({ version: 1, tables: [{ table: 'orders' }] });
		mocks.hasEffectiveWarehouseRestrictions.mockResolvedValue(false);
		mocks.getQueryDataFromCode.mockResolvedValue(queryData);

		await expect(
			getStoryQueryData('chat-1', 'orders', code, false, null, { viewerUserId: 'viewer-1' }),
		).resolves.toMatchObject({ queryData, code });

		expect(mocks.hasEffectiveWarehouseRestrictions).toHaveBeenCalledWith('project-1', 'viewer-1');
		expect(mocks.getStoryViewerDataCache).not.toHaveBeenCalled();
		expect(mocks.getQueryDataFromCode).toHaveBeenCalledWith('chat-1', code);
	});

	it('renders a safe story shell when every viewer query is access denied', async () => {
		const ownerCode = 'Owner-only customer narrative.\n<table query_id="query_customers" />';
		const safeCode = `${STORY_VIEWER_RESTRICTED_CODE_MARKER}\nViewer-specific narrative.\n<table query_id="query_customers" />`;
		mocks.getProjectRowSecurity.mockResolvedValue({ version: 1, tables: [{ table: 'orders' }] });
		mocks.getVersionById.mockResolvedValue({
			id: 'version-1',
			storyId: 'story-1',
			code: ownerCode,
			title: 'Customers',
			isLiveTextDynamic: false,
			format: 'classic',
		});
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_customers: {
				sqlQuery: 'SELECT first_name FROM customers',
				databaseId: 'analytics',
				adminMode: false,
			},
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				Response.json({ detail: 'Query blocked by Context table permissions.' }, { status: 403 }),
			),
		);

		await expect(
			getStoryQueryData('chat-1', 'customers', ownerCode, false, null, { viewerUserId: 'viewer-1' }),
		).resolves.toMatchObject({
			queryData: null,
			code: safeCode,
		});

		expect(mocks.generateText).not.toHaveBeenCalled();
		expect(mocks.upsertStoryViewerDataCache.mock.calls[0]!.at(-1)).toBe(safeCode);
	});

	it('strips hardcoded filter options from a cached non-live viewer snapshot', async () => {
		const ownerCode = 'Owner narrative\n<table query_id="query_warehouse" />';
		const viewerCode =
			`Viewer narrative\n<filter id="customer" type="select" table="customers" column="name" ` +
			`options='["Alice","Bob"]' />\n<table query_id="query_warehouse" />`;
		const safeViewerCode =
			'Viewer narrative\n<filter id="customer" type="select" table="customers" column="name" />\n' +
			'<table query_id="query_warehouse" />';
		const cachedAt = new Date(0);
		const queryData = {
			query_warehouse: {
				columns: ['region'],
				data: [{ region: 'viewer-region' }],
			},
		};
		mocks.getProjectRowSecurity.mockResolvedValue({
			version: 1,
			tables: [{ table: 'orders' }],
		});
		mocks.getStoryViewerDataCache.mockResolvedValue({ queryData, cachedAt, code: viewerCode });

		await expect(
			getStoryQueryData('chat-1', 'orders', ownerCode, false, null, { viewerUserId: 'viewer-1' }),
		).resolves.toEqual({
			queryData,
			cachedAt,
			code: safeViewerCode,
		});

		expect(mocks.getStoryViewerDataCache).toHaveBeenCalledWith(
			'chat-1',
			'orders',
			'version-1',
			'viewer-1',
			VIEWER_PERMISSION_REVISION,
		);
		expect(mocks.getQueryDataFromCode).not.toHaveBeenCalled();
		expect(mocks.buildToolContext).toHaveBeenCalledWith({
			projectId: 'project-1',
			userId: 'viewer-1',
			chatId: 'chat-1',
		});
	});

	it('falls back to stale viewer code when a viewer refresh fails', async () => {
		const ownerCode = 'Owner narrative\n<table query_id="query_admin" />';
		const viewerCode =
			`Viewer narrative\n<filter id="customer" type="select" table="customers" column="name" ` +
			`options='["Alice","Bob"]' />\n<table query_id="query_admin" />`;
		const safeViewerCode =
			'Viewer narrative\n<filter id="customer" type="select" table="customers" column="name" />\n' +
			'<table query_id="query_admin" />';
		const cachedAt = new Date(0);
		const queryData = {
			query_admin: {
				columns: ['id'],
				data: [{ id: 1 }],
			},
		};
		mocks.getProjectRowSecurity.mockResolvedValue({
			version: 1,
			tables: [{ table: 'orders' }],
		});
		mocks.getStoryViewerDataCache.mockResolvedValue({ queryData, cachedAt, code: viewerCode });
		mocks.getVersionById.mockResolvedValue({
			id: 'version-1',
			storyId: 'story-1',
			code: ownerCode,
			title: 'Orders',
			isLiveTextDynamic: false,
			format: 'classic',
		});
		mocks.getSqlQueriesFromCode.mockRejectedValue(new Error('refresh failed'));

		await expect(
			getStoryQueryData('chat-1', 'orders', ownerCode, true, '* * * * *', {
				viewerUserId: 'viewer-1',
			}),
		).resolves.toEqual({
			queryData,
			cachedAt,
			code: safeViewerCode,
		});
	});

	it('does not fall back to owner code when no viewer code exists', async () => {
		const ownerCode = 'Owner narrative\n<table query_id="query_admin" />';
		mocks.getProjectRowSecurity.mockResolvedValue({
			version: 1,
			tables: [{ table: 'orders' }],
		});
		mocks.getStoryViewerDataCache.mockResolvedValue({
			queryData: {},
			cachedAt: new Date(0),
			code: null,
		});
		mocks.getVersionById.mockResolvedValue({
			id: 'version-1',
			storyId: 'story-1',
			code: ownerCode,
			title: 'Orders',
			isLiveTextDynamic: false,
			format: 'classic',
		});
		mocks.getSqlQueriesFromCode.mockRejectedValue(new Error('refresh failed'));

		await expect(
			getStoryQueryData('chat-1', 'orders', ownerCode, false, null, {
				viewerUserId: 'viewer-1',
			}),
		).rejects.toThrow('refresh failed');
	});

	it('refreshes and caches the exact requested story version for a viewer', async () => {
		const code = '<table query_id="query_historical" />';
		const queryData = {
			query_historical: {
				columns: ['version'],
				data: [{ version: 'historical' }],
			},
		};
		mocks.getProjectRowSecurity.mockResolvedValue({
			version: 1,
			tables: [{ table: 'orders' }],
		});
		mocks.getVersionById.mockResolvedValue({
			id: 'version-historical',
			storyId: 'story-1',
			version: 1,
			code,
			title: 'Historical story',
			isLiveTextDynamic: false,
			format: 'classic',
		});
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_historical: {
				sqlQuery: 'SELECT version FROM historical_rows',
				adminMode: true,
			},
		});
		mocks.queryAppDb.mockResolvedValue({
			_version: '1',
			columns: ['version'],
			rows: [{ version: 'historical' }],
			rowCount: 1,
		});
		mocks.getProjectModelProvider.mockResolvedValue('openai');
		mocks.resolveProviderModel.mockResolvedValue({ model: { modelId: 'model-1' } });
		mocks.generateText.mockResolvedValue({
			output: { code },
			usage: {
				inputTokens: 1,
				inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
				outputTokens: 1,
				outputTokenDetails: { textTokens: 1, reasoningTokens: 0 },
				totalTokens: 2,
			},
		});

		await expect(
			getStoryQueryData('chat-1', 'orders', code, false, null, {
				storyVersionId: 'version-historical',
				viewerUserId: 'viewer-1',
			}),
		).resolves.toMatchObject({ queryData, code });

		expect(mocks.getVersionById).toHaveBeenCalledWith('chat-1', 'orders', 'version-historical');
		expect(mocks.getLatestVersionByChatAndSlug).not.toHaveBeenCalled();
		expect(mocks.upsertStoryViewerDataCache).toHaveBeenCalledWith(
			'story-1',
			'version-historical',
			'viewer-1',
			'project-1',
			0,
			0,
			VIEWER_PERMISSION_REVISION,
			queryData,
			{
				query_historical: querySource('SELECT version FROM historical_rows', null, true),
			},
			{},
			code,
		);
	});

	it('generates and caches viewer-specific classic story text when requested', async () => {
		const ownerCode =
			`Owner narrative\n<filter id="customer" type="select" table="customers" column="name" ` +
			`options='["Alice","Bob"]' />\n<table query_id="query_admin" />`;
		const viewerCode =
			`Viewer narrative\n<filter id="customer" type="select" table="customers" column="name" ` +
			`options='["Alice","Bob"]' />\n<table query_id="query_admin" />`;
		const safeViewerCode =
			'Viewer narrative\n<filter id="customer" type="select" table="customers" column="name" />\n' +
			'<table query_id="query_admin" />';
		const queryData = {
			query_admin: {
				columns: ['customer'],
				data: [{ customer: 'Visible customer' }],
			},
		};
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			id: 'version-1',
			storyId: 'story-1',
			version: 1,
			code: ownerCode,
			title: 'Customers',
			isLiveTextDynamic: false,
			format: 'classic',
		});
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_admin: {
				sqlQuery: 'SELECT customer FROM customers',
				adminMode: true,
			},
		});
		mocks.queryAppDb.mockResolvedValue({
			_version: '1',
			columns: ['customer'],
			rows: [{ customer: 'Visible customer' }],
			rowCount: 1,
		});
		mocks.getProjectModelProvider.mockResolvedValue('openai');
		mocks.resolveProviderModel.mockResolvedValue({ model: { modelId: 'model-1' } });
		mocks.generateText.mockResolvedValue({
			output: { code: viewerCode },
			usage: {
				inputTokens: 1,
				inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
				outputTokens: 1,
				outputTokenDetails: { textTokens: 1, reasoningTokens: 0 },
				totalTokens: 2,
			},
		});

		await expect(
			refreshStoryDataForDelivery('chat-1', 'customers', {
				viewerUserId: 'viewer-1',
				generateViewerCode: true,
			}),
		).resolves.toEqual({ queryData, code: safeViewerCode, narratives: {} });

		expect(mocks.updateLatestVersionCode).not.toHaveBeenCalled();
		expect(mocks.upsertStoryViewerDataCache).toHaveBeenCalledWith(
			'story-1',
			'version-1',
			'viewer-1',
			'project-1',
			0,
			0,
			VIEWER_PERMISSION_REVISION,
			queryData,
			{
				query_admin: querySource('SELECT customer FROM customers', null, true),
			},
			{},
			safeViewerCode,
		);
	});

	it('rewrites owner-derived headings and chart labels from a viewer-safe source', async () => {
		const ownerCode =
			'## Acme revenue: $2m\n' +
			`<chart query_id="query_admin" chart_type="kpi_card" title="Acme revenue: $2m" ` +
			`series='[{"data_key":"revenue","label":"Acme revenue: $2m"}]' />`;
		const viewerCode =
			'## Revenue available to you\n' +
			`<chart query_id="query_admin" chart_type="kpi_card" title="Visible revenue" ` +
			`series='[{"data_key":"revenue","label":"Visible revenue"}]' />`;
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			id: 'version-1',
			storyId: 'story-1',
			version: 1,
			code: ownerCode,
			title: 'Acme revenue: $2m',
			isLiveTextDynamic: false,
			format: 'classic',
		});
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_admin: {
				sqlQuery: 'SELECT revenue FROM revenue',
				adminMode: true,
			},
		});
		mocks.queryAppDb.mockResolvedValue({
			_version: '1',
			columns: ['revenue'],
			rows: [{ revenue: 10 }],
			rowCount: 1,
		});
		mocks.getProjectModelProvider.mockResolvedValue('openai');
		mocks.resolveProviderModel.mockResolvedValue({ model: { modelId: 'model-1' } });
		mocks.generateText.mockResolvedValue({
			output: { code: viewerCode },
			usage: {
				inputTokens: 1,
				inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
				outputTokens: 1,
				outputTokenDetails: { textTokens: 1, reasoningTokens: 0 },
				totalTokens: 2,
			},
		});

		await expect(
			refreshStoryDataForDelivery('chat-1', 'revenue', {
				viewerUserId: 'viewer-1',
				generateViewerCode: true,
			}),
		).resolves.toMatchObject({ code: viewerCode });

		const systemPrompt = mocks.generateText.mock.calls[0]![0].system;
		expect(systemPrompt).not.toContain('Acme');
		expect(systemPrompt).not.toContain('$2m');
		expect(systemPrompt).toContain('Viewer-specific section');
		expect(systemPrompt).toContain('"label":"Revenue"');
		expect(systemPrompt).not.toContain('"label":"Series"');
	});

	it('regenerates viewer custom narratives without owner-authored text', async () => {
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			id: 'version-1',
			storyId: 'story-1',
			version: 1,
			code: 'export default {}',
			title: 'Acme has 100 customers',
			isLiveTextDynamic: true,
			format: 'custom',
		});
		mocks.extractCustomStoryQueryIds.mockReturnValue(new Set(['query_admin']));
		mocks.listVersionFiles.mockResolvedValue([
			{
				path: 'app.tsx',
				content:
					"import { Narrative } from '@nao/story-kit'; export default () => <Narrative id='summary'>Acme has 100 customers</Narrative>;",
			},
		]);
		mocks.getLatestSqlQueriesByIds.mockResolvedValue({
			query_admin: {
				sqlQuery: 'SELECT customer_count FROM customer_summary',
				adminMode: true,
			},
		});
		mocks.queryAppDb.mockResolvedValue({
			_version: '1',
			columns: ['customer_count'],
			rows: [{ customer_count: 1 }],
			rowCount: 1,
		});
		mocks.getProjectModelProvider.mockResolvedValue('openai');
		mocks.resolveProviderModel.mockResolvedValue({ model: { modelId: 'model-1' } });
		mocks.generateText.mockResolvedValue({
			output: { narratives: [{ id: 'summary', text: 'One customer is available to you.' }] },
			usage: {
				inputTokens: 1,
				inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
				outputTokens: 1,
				outputTokenDetails: { textTokens: 1, reasoningTokens: 0 },
				totalTokens: 2,
			},
		});

		await expect(
			refreshStoryDataForDelivery('chat-1', 'customers', {
				viewerUserId: 'viewer-1',
			}),
		).resolves.toMatchObject({
			narratives: { summary: 'One customer is available to you.' },
		});

		const systemPrompt = mocks.generateText.mock.calls[0]![0].system;
		expect(systemPrompt).not.toContain('Acme');
		expect(systemPrompt).not.toContain('100 customers');
		expect(systemPrompt).toContain('Viewer-specific narrative.');
	});

	it('redacts static custom narratives in viewer delivery snapshots', async () => {
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			id: 'version-1',
			storyId: 'story-1',
			version: 1,
			code: 'export default {}',
			title: 'Customers',
			isLiveTextDynamic: false,
			format: 'custom',
		});
		mocks.extractCustomStoryQueryIds.mockReturnValue(new Set(['query_admin']));
		mocks.listVersionFiles.mockResolvedValue([
			{
				path: 'app.tsx',
				content:
					"import { Narrative } from '@nao/story-kit'; export default () => <Narrative id='summary'>Acme has 100 customers</Narrative>;",
			},
		]);
		mocks.getLatestSqlQueriesByIds.mockResolvedValue({
			query_admin: {
				sqlQuery: 'SELECT customer_count FROM customer_summary',
				adminMode: true,
			},
		});
		mocks.queryAppDb.mockResolvedValue({
			_version: '1',
			columns: ['customer_count'],
			rows: [{ customer_count: 1 }],
			rowCount: 1,
		});

		await expect(
			refreshStoryDataForDelivery('chat-1', 'customers', {
				viewerUserId: 'viewer-1',
			}),
		).resolves.toMatchObject({
			narratives: {
				[STORY_NARRATIVES_REDACT_MISSING_KEY]: '',
				summary: '',
			},
		});

		expect(mocks.generateText).not.toHaveBeenCalled();
	});

	it('falls back to redacted source when viewer classic story generation fails', async () => {
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			id: 'version-1',
			storyId: 'story-1',
			version: 1,
			code: 'Owner-only narrative.\n<table query_id="query_admin" />',
			title: 'Orders',
			isLiveTextDynamic: false,
			format: 'classic',
		});
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_admin: {
				sqlQuery: 'SELECT * FROM orders',
				adminMode: true,
			},
		});
		mocks.queryAppDb.mockResolvedValue({
			_version: '1',
			columns: ['id'],
			rows: [{ id: 1 }],
			rowCount: 1,
		});
		mocks.getProjectModelProvider.mockResolvedValue('openai');
		mocks.resolveProviderModel.mockResolvedValue({ model: { modelId: 'model-1' } });
		mocks.generateText.mockRejectedValue(new Error('Generation failed'));

		await expect(
			refreshStoryDataForDelivery('chat-1', 'orders', {
				viewerUserId: 'viewer-1',
				generateViewerCode: true,
			}),
		).resolves.toMatchObject({
			code: `${STORY_VIEWER_RESTRICTED_CODE_MARKER}\nViewer-specific narrative.\n<table query_id="query_admin" />`,
		});

		expect(mocks.generateText).toHaveBeenCalledOnce();
		expect(mocks.upsertStoryViewerDataCache.mock.calls[0]!.at(-1)).toBe(
			`${STORY_VIEWER_RESTRICTED_CODE_MARKER}\nViewer-specific narrative.\n<table query_id="query_admin" />`,
		);
	});

	it('rejects a viewer cache write when permissions change during refresh', async () => {
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			id: 'version-1',
			storyId: 'story-1',
			version: 1,
			code: '<table query_id="query_local" />',
			title: 'Orders',
			isLiveTextDynamic: false,
			format: 'classic',
		});
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_local: {
				sqlQuery: 'SELECT * FROM orders',
				databaseId: 'duckdb_local',
				adminMode: false,
			},
		});
		mocks.runQueryOnLocalFiles.mockResolvedValue({
			result: { columns: ['id'], data: [{ id: 1 }] },
		});
		mocks.buildToolContext
			.mockResolvedValueOnce(toolContext('tenant_id = 1'))
			.mockResolvedValueOnce(toolContext('tenant_id = 2'));

		await expect(refreshStoryData('chat-1', 'orders', { viewerUserId: 'viewer-1' })).rejects.toThrow(
			'Viewer permissions changed during story refresh',
		);

		expect(mocks.upsertStoryViewerDataCache).not.toHaveBeenCalled();
	});

	it('rejects viewer results when the atomic cache revision check fails', async () => {
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			id: 'version-1',
			storyId: 'story-1',
			version: 1,
			code: '<table query_id="query_local" />',
			title: 'Orders',
			isLiveTextDynamic: false,
			format: 'classic',
		});
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_local: {
				sqlQuery: 'SELECT * FROM orders',
				databaseId: 'duckdb_local',
				adminMode: false,
			},
		});
		mocks.runQueryOnLocalFiles.mockResolvedValue({
			result: { columns: ['id'], data: [{ id: 1 }] },
		});
		mocks.upsertStoryViewerDataCache.mockResolvedValue(false);

		await expect(refreshStoryData('chat-1', 'orders', { viewerUserId: 'viewer-1' })).rejects.toThrow(
			'Viewer permissions changed during story refresh',
		);
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
		mocks.getLatestVersionByChatAndSlug.mockRejectedValue(new Error('Warehouse unavailable'));

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
		mocks.getSqlQueriesFromCode.mockResolvedValue({
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
		expect(mocks.getLatestVersionByChatAndSlug).not.toHaveBeenCalled();
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
		expect(mocks.getLatestVersionByChatAndSlug).not.toHaveBeenCalled();
	});

	it.each([
		['the refresh after a failure', { deferRefresh: true }],
		['the first refresh', { deferFirstRefresh: true }],
	])('does not defer %s of a story without queries', async (_case, options) => {
		const code = '# Just a title';
		mocks.getStoryDataCacheByChatAndSlug.mockResolvedValue(null);
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue(storyVersion(code));
		mocks.getSqlQueriesFromCode.mockResolvedValue({});

		await expect(getStoryQueryData('chat-1', 'orders', code, true, null, options)).resolves.toEqual({
			queryData: null,
			cachedAt: expect.any(Date),
			code,
		});
		expect(mocks.getLatestVersionByChatAndSlug).toHaveBeenCalled();
	});

	it('still refreshes an expired cache inline when only the first refresh is deferred', async () => {
		const code = WAREHOUSE_STORY_CODE;
		mocks.getStoryDataCacheByChatAndSlug.mockResolvedValue(expiredCache());
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue(storyVersion(code));
		mocks.getSqlQueriesFromCode.mockResolvedValue({});

		const result = await getStoryQueryData('chat-1', 'orders', code, true, '* * * * *', {
			deferFirstRefresh: true,
		});

		expect(result.needsRefresh).toBeUndefined();
		expect(mocks.getLatestVersionByChatAndSlug).toHaveBeenCalled();
	});

	it('falls back to stored data when refresh fails without a cache', async () => {
		const code = WAREHOUSE_STORY_CODE;
		const queryData = {
			query_warehouse: {
				columns: ['id'],
				data: [{ id: 1 }],
			},
		};
		mocks.getLatestVersionByChatAndSlug.mockRejectedValue(new Error('Warehouse unavailable'));
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
});

function querySource(sql: string, databaseId: string | null = null, adminMode = false) {
	return {
		fingerprint: createHash('sha256').update(JSON.stringify({ sql, databaseId, adminMode })).digest('hex'),
		databaseId,
		adminMode,
	};
}

function storyVersion(code: string) {
	return {
		id: 'version-1',
		storyId: 'story-1',
		version: 1,
		code,
		isLiveTextDynamic: false,
		format: 'classic',
	};
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
