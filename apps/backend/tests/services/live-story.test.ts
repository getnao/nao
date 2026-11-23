import { createHash } from 'node:crypto';

import { STORY_NARRATIVES_REDACT_MISSING_KEY, STORY_QUERY_ACCESS_DENIED_MESSAGE } from '@nao/shared/story-app';
import { STORY_VIEWER_RESTRICTED_CODE_MARKER } from '@nao/shared/story-viewer-restrictions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getChatInfo: vi.fn(),
	getChatOwnerId: vi.fn(),
	getChatProjectId: vi.fn(),
	getVersionById: vi.fn(),
	getStoryByChatAndSlug: vi.fn(),
	getStoryById: vi.fn(),
	getStoryOwnerId: vi.fn(),
	getStoryProjectId: vi.fn(),
	getLatestVersionByStoryId: vi.fn(),
	getLatestSqlQueryDataByIds: vi.fn(),
	listStoryQueries: vi.fn(),
	getSqlQueriesByIds: vi.fn(),
	getSqlQueryById: vi.fn(),
	getLatestSqlQueriesByIds: vi.fn(),
	listVersionFiles: vi.fn(),
	getStoryDataCacheByChatAndSlug: vi.fn(),
	getStoryViewerDataCache: vi.fn(),
	getProjectViewerCacheRevision: vi.fn(),
	getStoryDataCacheByStoryId: vi.fn(),
	getUserRoleInProject: vi.fn(),
	getQueryDataFromCode: vi.fn(),
	getProjectRowSecurity: vi.fn(),
	queryAppDb: vi.fn(),
	runQueryOnLocalFiles: vi.fn(),
	buildToolContext: vi.fn(),
	buildChatlessToolContext: vi.fn(),
	hasEffectiveWarehouseRestrictions: vi.fn(),
	resolveExcludedColumnEnforcement: vi.fn(),
	upsertStoryViewerDataCache: vi.fn(),
	upsertStoryDataCacheByStoryId: vi.fn(),
	updateVersionCodeIfLatest: vi.fn(),
	findMissingQueryIds: vi.fn(),
	backfillMissingQueryData: vi.fn(),
	extractCustomStoryQueryIds: vi.fn(),
	generateText: vi.fn(),
	getProjectModelProvider: vi.fn(),
	resolveDefaultChatModel: vi.fn(),
	resolveDefaultModelSelection: vi.fn(),
	resolveProviderModel: vi.fn(),
	resolveUserBackgroundModelSelection: vi.fn(),
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
	getVersionById: mocks.getVersionById,
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

vi.mock('../../src/queries/story-viewer-data-cache.queries', () => ({
	getStoryViewerDataCache: mocks.getStoryViewerDataCache,
	getProjectViewerCacheRevision: mocks.getProjectViewerCacheRevision,
	upsertStoryViewerDataCache: mocks.upsertStoryViewerDataCache,
}));

vi.mock('../../src/queries/shared-story.queries', () => ({
	getQueryDataFromCode: mocks.getQueryDataFromCode,
}));

vi.mock('../../src/queries/user-group.queries', () => ({
	getProjectRowSecurity: mocks.getProjectRowSecurity,
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

vi.mock('../../src/services/user-group-context-access.service', () => ({
	hasEffectiveWarehouseRestrictions: mocks.hasEffectiveWarehouseRestrictions,
}));

vi.mock('../../src/services/user-group-llm-access.service', () => ({
	resolveUserBackgroundModelSelection: mocks.resolveUserBackgroundModelSelection,
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
	createViewerExecutionContext,
	executeLiveQuery,
	executeRawSql,
	executeStoryLiveQuery,
	getStoryQueryData,
	hasOnlyFrozenQueries,
	refreshStoryById,
	refreshStoryData,
	refreshStoryForViewer,
} from '../../src/services/live-story';
import { logger } from '../../src/utils/logger';

const WAREHOUSE_STORY_CODE = '<table query_id="query_warehouse" />';
const CHAT_STORY = { id: 'story-1', chatId: 'chat-1' };
const STANDALONE_STORY = { id: 'story-standalone', chatId: null };
const ACCESS_DENIED = { columns: [], data: [], accessDenied: true };

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
		warehouseColumnSecurity: { enforced: false },
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
	.update(
		JSON.stringify([
			toolContext().warehouseTableAccess,
			toolContext().warehouseColumnSecurity,
			toolContext().warehouseRowSecurity,
			false,
			0,
		]),
	)
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
		mocks.resolveUserBackgroundModelSelection.mockImplementation(
			async (_projectId: string, _userId: string, selection: unknown) => {
				return selection;
			},
		);
		mocks.getStoryByChatAndSlug.mockImplementation(async (_chatId, slug) => ({
			id: 'story-1',
			chatId: 'chat-1',
			slug,
		}));
		mocks.getStoryById.mockImplementation(async (storyId) => ({
			id: storyId,
			chatId: storyId === 'story-standalone' ? null : 'chat-1',
		}));
		mocks.getStoryProjectId.mockResolvedValue('project-1');
		mocks.getStoryOwnerId.mockResolvedValue('owner-1');
		mocks.getUserRoleInProject.mockResolvedValue('admin');
		mocks.getLatestVersionByStoryId.mockResolvedValue(storyVersion('<table query_id="query_admin" />'));
		mocks.listStoryQueries.mockResolvedValue({});
		mocks.getLatestSqlQueriesByIds.mockResolvedValue({});
		mocks.getSqlQueriesByIds.mockResolvedValue({});
		mocks.extractCustomStoryQueryIds.mockReturnValue(new Set());
		mocks.listVersionFiles.mockResolvedValue([]);
		mocks.buildChatlessToolContext.mockImplementation(async ({ userId }: { userId: string }) => ({
			projectFolder: '/project',
			projectId: 'project-1',
			userId,
			chatId: null,
			queryResults: new Map(),
			envVars: {},
			agentSettings: null,
			warehouseTableAccess: { enforced: false, strict: false, tables: [] },
			warehouseColumnSecurity: { enforced: false },
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
			warehouseColumnSecurity: { enforced: false },
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
		mocks.getStoryViewerDataCache.mockResolvedValue(null);
		mocks.getProjectViewerCacheRevision.mockResolvedValue(0);
		mocks.getProjectRowSecurity.mockResolvedValue({ version: 1, tables: [] });
		mocks.hasEffectiveWarehouseRestrictions.mockImplementation(
			async () => (await mocks.getProjectRowSecurity()).tables.length > 0,
		);
		mocks.findMissingQueryIds.mockReturnValue([]);
		mocks.upsertStoryDataCacheByStoryId.mockResolvedValue({});
		mocks.updateVersionCodeIfLatest.mockResolvedValue(true);
		mocks.resolveDefaultModelSelection.mockResolvedValue(null);
		mocks.resolveDefaultChatModel.mockImplementation(async () =>
			(await mocks.getProjectModelProvider()) ? { provider: 'openai', modelId: 'model-1' } : null,
		);
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
		expect(mocks.getProjectViewerCacheRevision).not.toHaveBeenCalled();
	});

	it('builds a viewer execution context whose permission revision follows the project cache revision', async () => {
		await expect(createStoryExecutionContext('chat-1', 'viewer-1')).resolves.toMatchObject({
			isViewerScoped: true,
			permissionRevision: VIEWER_PERMISSION_REVISION,
		});
		expect(mocks.getProjectViewerCacheRevision).toHaveBeenCalledOnce();
		expect(mocks.getProjectViewerCacheRevision).toHaveBeenCalledWith('project-1');

		mocks.getProjectViewerCacheRevision.mockResolvedValue(1);

		const { permissionRevision } = await createViewerExecutionContext(
			{ projectId: 'project-1', chatId: 'chat-1' },
			'viewer-1',
		);
		expect(permissionRevision).not.toBe(VIEWER_PERMISSION_REVISION);
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
		mocks.getSqlQueriesByIds.mockResolvedValue({
			query_orders: { sqlQuery: 'SELECT * FROM orders', databaseId: 'analytics', adminMode: false },
		});
		stubWarehouseFetch({ columns: ['id'], data: [{ id: 1 }] });
		mocks.runQueryOnLocalFiles.mockResolvedValue({
			result: { columns: ['id'], data: [{ id: 1 }] },
		});

		await expect(executeLiveQuery('chat-1', 'query_local', { viewerUserId: 'viewer-1' })).resolves.toEqual({
			columns: ['id'],
			data: [{ id: 1 }],
		});

		expect(mocks.buildToolContext).toHaveBeenCalledWith({
			projectId: 'project-1',
			userId: 'viewer-1',
			chatId: 'chat-1',
			querySource: 'story',
		});
	});

	it('denies a viewer a local live query reading a query that has no SQL to rerun', async () => {
		mocks.getProjectRowSecurity.mockResolvedValue({ version: 1, tables: [{ table: 'orders' }] });
		mocks.getSqlQueryById.mockResolvedValue({
			sqlQuery: 'SELECT * FROM query_orders',
			databaseId: 'duckdb_local',
			adminMode: false,
		});

		await expect(executeLiveQuery('chat-1', 'query_local', { viewerUserId: 'viewer-1' })).rejects.toThrow(
			STORY_QUERY_ACCESS_DENIED_MESSAGE,
		);

		expect(mocks.runQueryOnLocalFiles).not.toHaveBeenCalled();
		expect(mocks.getLatestSqlQueryDataByIds).not.toHaveBeenCalled();
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
			undefined,
			undefined,
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
			column_security: { enforced: false },
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

	it('fails an owner refresh when the warehouse denies table access', async () => {
		const code = '<table query_id="query_orders" />\n<table query_id="query_customers" />';
		mocks.getLatestVersionByStoryId.mockResolvedValue(storyVersion(code));
		mocks.getLatestSqlQueriesByIds.mockResolvedValue({
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
		expect(mocks.upsertStoryDataCacheByStoryId).not.toHaveBeenCalled();
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

	it('propagates denied upstream access without running dependent local queries', async () => {
		const code = '<chart query_id="query_local" />\n<chart query_id="query_allowed" />';
		const allowedRows = { columns: ['order_count'], data: [{ order_count: 99 }] };
		mocks.getLatestVersionByStoryId.mockResolvedValue(storyVersion(code));
		mocks.getLatestSqlQueriesByIds.mockResolvedValueOnce({
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
		mocks.getLatestSqlQueriesByIds.mockResolvedValueOnce({
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

		await expect(refreshStoryForViewer(CHAT_STORY, 'viewer-1')).resolves.toEqual({
			queryData: { query_local: ACCESS_DENIED, query_allowed: allowedRows },
			narratives: {},
			code: `${STORY_VIEWER_RESTRICTED_CODE_MARKER}\n${code}`,
			cachedAt: expect.any(Date),
		});

		expect(mocks.runQueryOnLocalFiles).not.toHaveBeenCalled();
		expect(mocks.upsertStoryViewerDataCache.mock.calls[0]![0].queryData).toEqual({
			query_local: ACCESS_DENIED,
			query_allowed: allowedRows,
		});
		expect(mocks.upsertStoryDataCacheByStoryId).not.toHaveBeenCalled();
	});

	it('denies a viewer a local query reading a query that has no SQL to rerun', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue(storyVersion('<chart query_id="query_local" />'));
		mocks.getLatestSqlQueriesByIds.mockResolvedValueOnce({
			query_local: {
				sqlQuery: 'SELECT count(*) AS customer_count FROM query_customers',
				databaseId: 'duckdb_local',
				adminMode: false,
			},
		});

		await expect(refreshStoryForViewer(CHAT_STORY, 'viewer-1')).resolves.toMatchObject({
			queryData: { query_local: ACCESS_DENIED },
		});

		expect(mocks.runQueryOnLocalFiles).not.toHaveBeenCalled();
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
		mocks.getLatestSqlQueriesByIds.mockResolvedValue({
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
		expect(mocks.upsertStoryViewerDataCache.mock.calls[0]![0]).toMatchObject({
			queryData: { query_customers: ACCESS_DENIED },
			code: safeCode,
		});
	});

	it('serves a cached viewer snapshot without the queries the viewer cannot read', async () => {
		const ownerCode = 'Owner narrative\n<table query_id="query_warehouse" />\n<table query_id="query_customers" />';
		const viewerCode =
			'Viewer narrative\n<table query_id="query_warehouse" />\n<table query_id="query_customers" />';
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
		mocks.getStoryViewerDataCache.mockResolvedValue({
			queryData: { ...queryData, query_customers: ACCESS_DENIED },
			cachedAt,
			code: viewerCode,
			analysisResults: null,
		});

		await expect(
			getStoryQueryData('chat-1', 'orders', ownerCode, false, null, { viewerUserId: 'viewer-1' }),
		).resolves.toEqual({
			queryData,
			cachedAt,
			code: viewerCode,
		});

		expect(mocks.getStoryViewerDataCache).toHaveBeenCalledWith({
			storyId: 'story-1',
			storyVersionId: 'version-1',
			userId: 'viewer-1',
			permissionRevision: VIEWER_PERMISSION_REVISION,
		});
		expect(mocks.getQueryDataFromCode).not.toHaveBeenCalled();
		expect(mocks.upsertStoryViewerDataCache).not.toHaveBeenCalled();
		expect(mocks.buildToolContext).toHaveBeenCalledWith({
			projectId: 'project-1',
			userId: 'viewer-1',
			chatId: 'chat-1',
			querySource: 'story',
		});
	});

	it('reads the owner copy when the restricted viewer is the chat owner', async () => {
		const code = WAREHOUSE_STORY_CODE;
		const queryData = {
			query_warehouse: {
				columns: ['region'],
				data: [{ region: 'owner-region' }],
			},
		};
		mocks.hasEffectiveWarehouseRestrictions.mockResolvedValue(true);
		mocks.getQueryDataFromCode.mockResolvedValue(queryData);

		await expect(
			getStoryQueryData('chat-1', 'orders', code, false, null, { viewerUserId: 'owner-1' }),
		).resolves.toMatchObject({ queryData, code });

		expect(mocks.getStoryViewerDataCache).not.toHaveBeenCalled();
		expect(mocks.getQueryDataFromCode).toHaveBeenCalledWith('chat-1', code);
	});

	it('falls back to the stale viewer snapshot when a viewer refresh fails', async () => {
		const ownerCode = 'Owner narrative\n<table query_id="query_admin" />';
		const viewerCode = 'Viewer narrative\n<table query_id="query_admin" />';
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
		mocks.getStoryViewerDataCache.mockResolvedValue({
			queryData,
			cachedAt,
			code: viewerCode,
			analysisResults: null,
		});
		mocks.getVersionById.mockResolvedValue({
			id: 'version-1',
			storyId: 'story-1',
			code: ownerCode,
			title: 'Orders',
			isLiveTextDynamic: false,
			format: 'classic',
		});
		mocks.getLatestSqlQueriesByIds.mockRejectedValue(new Error('refresh failed'));

		await expect(
			getStoryQueryData('chat-1', 'orders', ownerCode, true, '* * * * *', {
				viewerUserId: 'viewer-1',
			}),
		).resolves.toEqual({
			queryData,
			cachedAt,
			code: viewerCode,
		});

		expect(mocks.getLatestSqlQueriesByIds).toHaveBeenCalled();
		expect(mocks.getStoryViewerDataCache).toHaveBeenCalledOnce();
		expect(mocks.buildToolContext).toHaveBeenCalledOnce();
	});

	it('does not fall back to the owner copy when a viewer refresh fails without a viewer snapshot', async () => {
		const ownerCode = 'Owner narrative\n<table query_id="query_admin" />';
		mocks.getProjectRowSecurity.mockResolvedValue({
			version: 1,
			tables: [{ table: 'orders' }],
		});
		mocks.getVersionById.mockResolvedValue({
			id: 'version-1',
			storyId: 'story-1',
			code: ownerCode,
			title: 'Orders',
			isLiveTextDynamic: false,
			format: 'classic',
		});
		mocks.getLatestSqlQueriesByIds.mockRejectedValue(new Error('refresh failed'));

		await expect(
			getStoryQueryData('chat-1', 'orders', ownerCode, false, null, {
				viewerUserId: 'viewer-1',
			}),
		).rejects.toThrow('refresh failed');

		expect(mocks.getQueryDataFromCode).not.toHaveBeenCalled();
		expect(mocks.getStoryDataCacheByChatAndSlug).not.toHaveBeenCalled();
	});

	it('shares one refresh between the blocks of a page asking for the same viewer snapshot', async () => {
		const code = '<table query_id="query_admin" />';
		const queryData = { query_admin: { columns: ['id'], data: [{ id: 1 }] } };
		mocks.getProjectRowSecurity.mockResolvedValue({ version: 1, tables: [{ table: 'orders' }] });
		mocks.getVersionById.mockResolvedValue(storyVersion(code));
		mocks.getLatestSqlQueriesByIds.mockResolvedValue({
			query_admin: { sqlQuery: 'SELECT id FROM orders', adminMode: true },
		});
		mocks.queryAppDb.mockResolvedValue({ _version: '1', columns: ['id'], rows: [{ id: 1 }], rowCount: 1 });
		const readSnapshot = () =>
			getStoryQueryData('chat-1', 'orders', code, false, null, { viewerUserId: 'viewer-1' });

		const snapshots = await Promise.all([readSnapshot(), readSnapshot()]);

		expect(snapshots[0]).toMatchObject({ queryData });
		expect(snapshots[1]).toEqual(snapshots[0]);
		expect(mocks.queryAppDb).toHaveBeenCalledOnce();
		expect(mocks.upsertStoryViewerDataCache).toHaveBeenCalledOnce();
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
		mocks.getLatestSqlQueriesByIds.mockResolvedValue({
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

		const viewerCode = `${STORY_VIEWER_RESTRICTED_CODE_MARKER}\n${code}`;
		await expect(
			getStoryQueryData('chat-1', 'orders', code, false, null, {
				storyVersionId: 'version-historical',
				viewerUserId: 'viewer-1',
			}),
		).resolves.toMatchObject({ queryData, code: viewerCode });

		expect(mocks.getVersionById).toHaveBeenCalledWith('story-1', 'version-historical');
		expect(mocks.getLatestVersionByStoryId).not.toHaveBeenCalled();
		expect(mocks.upsertStoryViewerDataCache).toHaveBeenCalledWith({
			storyId: 'story-1',
			storyVersionId: 'version-historical',
			userId: 'viewer-1',
			permissionRevision: VIEWER_PERMISSION_REVISION,
			queryData,
			code: viewerCode,
			analysisResults: {},
			cachedAt: expect.any(Date),
		});
	});

	it('generates and caches viewer-specific classic story text, marked as restricted even when the rewrite drops the marker', async () => {
		const ownerCode =
			`Owner narrative\n<filter id="customer" type="select" table="customers" column="name" ` +
			`options='["Alice","Bob"]' />\n<table query_id="query_admin" />`;
		const viewerCode =
			`Viewer narrative\n<filter id="customer" type="select" table="customers" column="name" ` +
			`options='["Alice","Bob"]' />\n<table query_id="query_admin" />`;
		const safeViewerCode =
			`${STORY_VIEWER_RESTRICTED_CODE_MARKER}\nViewer narrative\n` +
			'<filter id="customer" type="select" table="customers" column="name" />\n' +
			'<table query_id="query_admin" />';
		const queryData = {
			query_admin: {
				columns: ['customer'],
				data: [{ customer: 'Visible customer' }],
			},
		};
		mocks.getLatestVersionByStoryId.mockResolvedValue({
			id: 'version-1',
			storyId: 'story-1',
			version: 1,
			code: ownerCode,
			title: 'Customers',
			isLiveTextDynamic: false,
			format: 'classic',
		});
		mocks.getLatestSqlQueriesByIds.mockResolvedValue({
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

		const cachedAt = expect.any(Date);
		await expect(refreshStoryForViewer(CHAT_STORY, 'viewer-1')).resolves.toEqual({
			queryData,
			code: safeViewerCode,
			narratives: {},
			cachedAt,
		});

		expect(mocks.updateVersionCodeIfLatest).not.toHaveBeenCalled();
		expect(mocks.upsertStoryDataCacheByStoryId).not.toHaveBeenCalled();
		expect(mocks.upsertStoryViewerDataCache).toHaveBeenCalledWith({
			storyId: 'story-1',
			storyVersionId: 'version-1',
			userId: 'viewer-1',
			permissionRevision: VIEWER_PERMISSION_REVISION,
			queryData,
			code: safeViewerCode,
			analysisResults: {},
			cachedAt,
		});
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
		mocks.getLatestVersionByStoryId.mockResolvedValue({
			id: 'version-1',
			storyId: 'story-1',
			version: 1,
			code: ownerCode,
			title: 'Acme revenue: $2m',
			isLiveTextDynamic: false,
			format: 'classic',
		});
		mocks.getLatestSqlQueriesByIds.mockResolvedValue({
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

		await expect(refreshStoryForViewer(CHAT_STORY, 'viewer-1')).resolves.toMatchObject({
			code: `${STORY_VIEWER_RESTRICTED_CODE_MARKER}\n${viewerCode}`,
		});

		const systemPrompt = mocks.generateText.mock.calls[0]![0].system;
		expect(systemPrompt).not.toContain('Acme');
		expect(systemPrompt).not.toContain('$2m');
		expect(systemPrompt).toContain('Viewer-specific section');
		expect(systemPrompt).toContain('"label":"Revenue"');
		expect(systemPrompt).not.toContain('"label":"Series"');
	});

	it('regenerates viewer custom narratives without owner-authored text', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue({
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

		await expect(refreshStoryForViewer(CHAT_STORY, 'viewer-1')).resolves.toMatchObject({
			narratives: { summary: 'One customer is available to you.' },
		});

		const systemPrompt = mocks.generateText.mock.calls[0]![0].system;
		expect(systemPrompt).not.toContain('Acme');
		expect(systemPrompt).not.toContain('100 customers');
		expect(systemPrompt).toContain('Viewer-specific narrative.');
	});

	it('redacts static custom narratives in viewer snapshots', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue({
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

		await expect(refreshStoryForViewer(CHAT_STORY, 'viewer-1')).resolves.toMatchObject({
			narratives: {
				[STORY_NARRATIVES_REDACT_MISSING_KEY]: '',
				summary: '',
			},
		});

		expect(mocks.generateText).not.toHaveBeenCalled();
	});

	it('falls back to redacted source when viewer classic story generation fails', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue({
			id: 'version-1',
			storyId: 'story-1',
			version: 1,
			code: 'Owner-only narrative.\n<table query_id="query_admin" />',
			title: 'Orders',
			isLiveTextDynamic: false,
			format: 'classic',
		});
		mocks.getLatestSqlQueriesByIds.mockResolvedValue({
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

		const safeCode = `${STORY_VIEWER_RESTRICTED_CODE_MARKER}\nViewer-specific narrative.\n<table query_id="query_admin" />`;

		await expect(refreshStoryForViewer(CHAT_STORY, 'viewer-1')).resolves.toMatchObject({ code: safeCode });

		expect(mocks.generateText).toHaveBeenCalledOnce();
		expect(mocks.upsertStoryViewerDataCache.mock.calls[0]![0].code).toBe(safeCode);
	});

	it('gives a viewer the viewer-safe source of a classic story that has no SQL to run', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue(
			storyVersion('Owner-only narrative.\n<table query_id="query_frozen" />'),
		);
		mocks.getProjectModelProvider.mockResolvedValue('openai');
		mocks.resolveProviderModel.mockResolvedValue({ model: { modelId: 'model-1' } });

		await expect(refreshStoryForViewer(CHAT_STORY, 'viewer-1')).resolves.toMatchObject({
			queryData: { query_frozen: ACCESS_DENIED },
			code: `${STORY_VIEWER_RESTRICTED_CODE_MARKER}\nViewer-specific narrative.\n<table query_id="query_frozen" />`,
		});

		expect(mocks.generateText).not.toHaveBeenCalled();
		expect(mocks.getLatestSqlQueryDataByIds).not.toHaveBeenCalled();
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

	it('sends the owner column policy and propagates a denied-column guard failure', async () => {
		mocks.buildToolContext.mockResolvedValueOnce({
			projectFolder: '/project',
			projectId: 'project-1',
			userId: 'owner-1',
			chatId: 'chat-1',
			queryResults: new Map(),
			envVars: {},
			azureAccessToken: null,
			agentSettings: null,
			warehouseTableAccess: { enforced: false },
			warehouseColumnSecurity: {
				enforced: true,
				tables: [
					{
						databaseType: 'duckdb',
						database: 'analytics',
						schema: 'main',
						table: 'orders',
						restrictedColumns: ['cost'],
						access: 'restricted',
						deniedColumns: ['cost'],
					},
				],
			},
			warehouseRowSecurity: { enforced: false },
		});
		const fetchMock = vi.fn(async () =>
			Response.json({ detail: 'Column access denied: main.orders.cost' }, { status: 400 }),
		);
		vi.stubGlobal('fetch', fetchMock);
		const executionContext = await createStoryExecutionContext('chat-1');

		await expect(executeRawSql('SELECT cost FROM orders', { executionContext })).rejects.toThrow(
			'main.orders.cost',
		);
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
			column_security: {
				enforced: true,
				tables: [expect.objectContaining({ table: 'orders', access: 'restricted', denied_columns: ['cost'] })],
			},
		});
	});

	it('sends an owner grant as full column access', async () => {
		const baseContext = await mocks.buildToolContext();
		mocks.buildToolContext.mockResolvedValueOnce({
			...baseContext,
			warehouseColumnSecurity: {
				enforced: true,
				tables: [
					{
						databaseType: 'duckdb',
						database: 'analytics',
						schema: 'main',
						table: 'orders',
						restrictedColumns: ['cost'],
						access: 'full',
					},
				],
			},
		});
		const fetchMock = vi.fn(async () => Response.json({ data: [{ cost: 10 }], row_count: 1, columns: ['cost'] }));
		vi.stubGlobal('fetch', fetchMock);
		const executionContext = await createStoryExecutionContext('chat-1');

		await expect(executeRawSql('SELECT cost FROM orders', { executionContext })).resolves.toMatchObject({
			data: [{ cost: 10 }],
		});
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
			column_security: {
				enforced: true,
				tables: [expect.objectContaining({ table: 'orders', access: 'full' })],
			},
		});
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

	it('refreshes a standalone viewer snapshot with the viewer context and without a chat', async () => {
		mocks.getLatestVersionByStoryId.mockResolvedValue({
			...storyVersion(WAREHOUSE_STORY_CODE),
			storyId: 'story-standalone',
		});
		mocks.listStoryQueries.mockResolvedValue({
			query_warehouse: { sqlQuery: 'SELECT * FROM orders', databaseId: 'analytics', adminMode: false },
		});
		stubWarehouseFetch({ columns: ['order_id'], data: [{ order_id: 1 }] });

		await expect(refreshStoryForViewer(STANDALONE_STORY, 'viewer-1')).resolves.toEqual({
			queryData: { query_warehouse: { columns: ['order_id'], data: [{ order_id: 1 }] } },
			narratives: {},
			code: `${STORY_VIEWER_RESTRICTED_CODE_MARKER}\n${WAREHOUSE_STORY_CODE}`,
			cachedAt: expect.any(Date),
		});

		expect(mocks.buildChatlessToolContext).toHaveBeenCalledWith({
			projectId: 'project-1',
			userId: 'viewer-1',
			querySource: 'story',
		});
		expect(mocks.buildToolContext).not.toHaveBeenCalled();
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

			await expect(hasOnlyFrozenQueries(STANDALONE_STORY)).resolves.toBe(expected);
		},
	);

	it('shows the saved rows of a standalone query that has no SQL to rerun', async () => {
		const savedRows = { columns: ['order_id'], data: [{ order_id: 7 }] };
		mocks.getStoryDataCacheByStoryId.mockResolvedValue({ queryData: { query_frozen: savedRows } });

		await expect(executeStoryLiveQuery(STANDALONE_STORY, 'query_frozen')).resolves.toEqual(savedRows);
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
