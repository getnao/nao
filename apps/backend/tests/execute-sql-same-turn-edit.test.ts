import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/license.service', () => ({
	hasFeature: vi.fn(async () => false),
	LICENSE_FEATURES: { excludeColumns: 'exclude-columns' },
}));
vi.mock('../src/queries/execute-sql.queries', () => ({
	EXECUTE_SEMANTIC_QUERY_TOOL_NAME: 'execute_semantic_query',
	getExecuteSqlPartByQueryIdInChat: vi.fn(async () => null),
	updateExecuteSqlPart: vi.fn(),
}));
vi.mock('../src/queries/project.queries', () => ({
	getAgentSettings: vi.fn(),
}));
vi.mock('../src/agents/tools/query-app-db', () => ({
	queryAppDb: vi.fn(),
}));
vi.mock('../src/services/local-query.service', () => ({
	runQueryOnLocalFiles: vi.fn(),
}));

import type { ToolCallOptions } from 'ai';

import executeSqlTool, { executeQuery } from '../src/agents/tools/execute-sql';
import { getExecuteSqlPartByQueryIdInChat, updateExecuteSqlPart } from '../src/queries/execute-sql.queries';
import { runQueryOnLocalFiles } from '../src/services/local-query.service';
import type { ToolContext } from '../src/types/tools';

describe('execute_sql in-place edit of a query created in the current turn', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ data: [{ n: 1 }], row_count: 1, columns: ['n'] })),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('re-runs a same-turn SQL query under its id when it is not persisted yet', async () => {
		const context = createContext();
		const created = await executeQuery({ sql_query: 'SELECT 1 AS n' }, context);

		const edited = await runTool({ sql_query: 'SELECT 2 AS n', query_id: created.id }, context);

		expect(getExecuteSqlPartByQueryIdInChat).toHaveBeenCalledWith('chat-1', created.id);
		expect(edited.id).toBe(created.id);
		expect(context.queryResults.get(created.id)).toEqual({ columns: ['n'], data: [{ n: 1 }] });
		expect(updateExecuteSqlPart).not.toHaveBeenCalled();
	});

	it('retains an applied SQL limit in the cached query result', async () => {
		const context = createContext();
		vi.mocked(runQueryOnLocalFiles).mockResolvedValueOnce({
			result: { columns: ['user_id'], data: [{ user_id: 'a' }] },
		});

		const output = await executeQuery(
			{ sql_query: "SELECT user_id FROM read_csv('/home/users.csv') LIMIT 1", database_id: 'duckdb_local' },
			context,
		);

		expect(context.queryResults.get(output.id)).toEqual({
			columns: ['user_id'],
			data: [{ user_id: 'a' }],
			appliedLimit: 1,
		});
	});

	it('retains decimal metadata in the cache and persisted tool output', async () => {
		const context = createContext();
		vi.mocked(runQueryOnLocalFiles).mockResolvedValueOnce({
			result: {
				columns: ['ratio'],
				data: [{ ratio: '1.2500' }],
				decimalColumns: { ratio: { precision: 20, scale: 4 } },
			},
		});

		const output = await executeQuery(
			{ sql_query: 'SELECT 1.2500::DECIMAL(20,4) AS ratio', database_id: 'duckdb_local' },
			context,
		);

		expect(output.decimal_columns).toEqual({ ratio: { precision: 20, scale: 4 } });
		expect(context.queryResults.get(output.id)?.decimalColumns).toEqual({
			ratio: { precision: 20, scale: 4 },
		});
	});

	it('binds a complete earlier result as a BigQuery array parameter', async () => {
		const context = createContext();
		context.queryResults.set('query_ab12cd34', {
			columns: ['user_id'],
			data: [{ user_id: 'a' }, { user_id: 'b' }, { user_id: 'a' }, { user_id: null }],
		});

		await executeQuery(
			{
				sql_query: 'SELECT * FROM users WHERE user_id IN UNNEST(@users)',
				database_id: 'bigquery-prod',
				array_parameters: [{ name: 'users', query_id: 'query_ab12cd34', column: 'user_id', type: 'STRING' }],
			},
			context,
		);

		const request = vi.mocked(fetch).mock.calls[0]?.[1];
		const body = JSON.parse(String(request?.body)) as { query_parameters: unknown };
		expect(body.query_parameters).toEqual([{ name: 'users', type: 'STRING', values: ['a', 'b'] }]);
	});

	it('rejects a same-turn parameter source that reached its SQL limit', async () => {
		const context = createContext();
		context.queryResults.set('query_ab12cd34', {
			columns: ['user_id'],
			data: [{ user_id: 'a' }, { user_id: 'b' }],
			appliedLimit: 2,
		});

		await expect(
			executeQuery(
				{
					sql_query: 'SELECT * FROM users WHERE user_id IN UNNEST(@users)',
					database_id: 'bigquery-prod',
					array_parameters: [
						{ name: 'users', query_id: 'query_ab12cd34', column: 'user_id', type: 'STRING' },
					],
				},
				context,
			),
		).rejects.toThrow('Query query_ab12cd34 may be truncated by LIMIT 2');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('rejects a persisted parameter source that reached its SQL limit', async () => {
		vi.mocked(getExecuteSqlPartByQueryIdInChat).mockResolvedValueOnce({
			toolCallId: 'call-source',
			toolName: 'execute_sql',
			toolInput: { sql_query: "SELECT user_id FROM read_csv('/home/users.csv') LIMIT 2" },
			toolOutput: {
				_version: '1',
				id: 'query_ab12cd34',
				columns: ['user_id'],
				data: [{ user_id: 'a' }, { user_id: 'b' }],
				row_count: 2,
				applied_limit: 2,
			},
			adminMode: false,
		});

		await expect(
			executeQuery(
				{
					sql_query: 'SELECT * FROM users WHERE user_id IN UNNEST(@users)',
					database_id: 'bigquery-prod',
					array_parameters: [
						{ name: 'users', query_id: 'query_ab12cd34', column: 'user_id', type: 'STRING' },
					],
				},
				createContext(),
			),
		).rejects.toThrow('Query query_ab12cd34 may be truncated by LIMIT 2');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('accepts a parameter source that returned fewer rows than its SQL limit', async () => {
		const context = createContext();
		context.queryResults.set('query_ab12cd34', {
			columns: ['user_id'],
			data: [{ user_id: 'a' }],
			appliedLimit: 2,
		});

		await executeQuery(
			{
				sql_query: 'SELECT * FROM users WHERE user_id IN UNNEST(@users)',
				database_id: 'bigquery-prod',
				array_parameters: [{ name: 'users', query_id: 'query_ab12cd34', column: 'user_id', type: 'STRING' }],
			},
			context,
		);

		expect(fetch).toHaveBeenCalledOnce();
		const request = vi.mocked(fetch).mock.calls[0]?.[1];
		const body = JSON.parse(String(request?.body)) as { query_parameters: unknown };
		expect(body.query_parameters).toEqual([{ name: 'users', type: 'STRING', values: ['a'] }]);
	});

	it('accepts BigQuery scalar array parameter types', async () => {
		const context = createContext();
		context.queryResults.set('query_ab12cd34', {
			columns: [
				'numeric',
				'bignumeric',
				'date',
				'datetime',
				'time',
				'timestamp',
				'interval',
				'bytes',
				'geography',
				'json',
			],
			data: [
				{
					numeric: '123.45',
					bignumeric: '12345678901234567890.123456789',
					date: '2026-10-15',
					datetime: '2026-10-15 10:30:00.123456',
					time: '10:30:00.123456',
					timestamp: '2026-10-15T10:30:00Z',
					interval: '0-0 7 00:00:00',
					bytes: 'aGVsbG8=',
					geography: 'POINT(1 2)',
					json: { answer: 42, tags: ['nao'] },
				},
			],
		});

		const types = [
			['numeric', 'NUMERIC'],
			['bignumeric', 'BIGNUMERIC'],
			['date', 'DATE'],
			['datetime', 'DATETIME'],
			['time', 'TIME'],
			['timestamp', 'TIMESTAMP'],
			['interval', 'INTERVAL'],
			['bytes', 'BYTES'],
			['geography', 'GEOGRAPHY'],
			['json', 'JSON'],
		] as const;
		await executeQuery(
			{
				sql_query: 'SELECT 1',
				database_id: 'bigquery-prod',
				array_parameters: types.map(([column, type]) => ({
					name: column,
					query_id: 'query_ab12cd34',
					column,
					type,
				})),
			},
			context,
		);

		const request = vi.mocked(fetch).mock.calls[0]?.[1];
		const body = JSON.parse(String(request?.body)) as {
			query_parameters: Array<{ name: string; type: string; values: unknown[] }>;
		};
		expect(body.query_parameters).toEqual(
			types.map(([name, type]) => ({
				name,
				type,
				values: [context.queryResults.get('query_ab12cd34')!.data[0]![name]],
			})),
		);
	});

	it('rejects a BYTES source value that is not base64', async () => {
		const context = createContext();
		context.queryResults.set('query_ab12cd34', {
			columns: ['payload'],
			data: [{ payload: 'not base64!' }],
		});

		await expect(
			executeQuery(
				{
					sql_query: 'SELECT * FROM files WHERE payload IN UNNEST(@payloads)',
					database_id: 'bigquery-prod',
					array_parameters: [
						{
							name: 'payloads',
							query_id: 'query_ab12cd34',
							column: 'payload',
							type: 'BYTES',
						},
					],
				},
				context,
			),
		).rejects.toThrow('contains a value incompatible with BYTES');
		expect(fetch).not.toHaveBeenCalled();
	});

	it.each(['NUMERIC', 'BIGNUMERIC'] as const)('rejects an inexact JavaScript number for %s', async (type) => {
		const context = createContext();
		context.queryResults.set('query_ab12cd34', {
			columns: ['amount'],
			data: [{ amount: 123456789012345.67 }],
		});

		await expect(
			executeQuery(
				{
					sql_query: 'SELECT 1',
					database_id: 'bigquery-prod',
					array_parameters: [{ name: 'amounts', query_id: 'query_ab12cd34', column: 'amount', type }],
				},
				context,
			),
		).rejects.toThrow(
			`BigQuery array parameter "amounts" received a JavaScript number for ${type}, which may have already lost precision.`,
		);
	});

	it('rejects an array parameter whose source column does not exist', async () => {
		const context = createContext();
		context.queryResults.set('query_ab12cd34', { columns: ['user_id'], data: [{ user_id: 'a' }] });

		await expect(
			executeQuery(
				{
					sql_query: 'SELECT * FROM users WHERE user_id IN UNNEST(@users)',
					database_id: 'bigquery-prod',
					array_parameters: [
						{ name: 'users', query_id: 'query_ab12cd34', column: 'missing', type: 'STRING' },
					],
				},
				context,
			),
		).rejects.toThrow('Column "missing" not found in query query_ab12cd34');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('refuses to edit a same-turn semantic query as SQL', async () => {
		const context = createContext();
		const created = await executeQuery({ sql_query: 'SELECT 1 AS n' }, context, {
			compiledBySemanticLayer: true,
		});

		await expect(runTool({ sql_query: 'SELECT 2 AS n', query_id: created.id }, context)).rejects.toThrow(
			`Query ${created.id} is a semantic query and cannot be edited as SQL`,
		);
	});

	it('still reports unknown query ids', async () => {
		await expect(
			runTool({ sql_query: 'SELECT 2 AS n', query_id: 'query_missing0' }, createContext()),
		).rejects.toThrow('Query query_missing0 not found in this chat');
	});
});

async function runTool(input: Parameters<typeof executeQuery>[0], context: ToolContext) {
	const options = { toolCallId: 'call-1', messages: [], experimental_context: context } as ToolCallOptions;
	const output = await executeSqlTool.execute!(input, options);
	return output as Awaited<ReturnType<typeof executeQuery>>;
}

function createContext(): ToolContext {
	return {
		projectFolder: '/tmp/project',
		chatId: 'chat-1',
		userId: 'user-1',
		projectId: 'project-1',
		supportsCustomCharts: false,
		agentSettings: {},
		envVars: {},
		warehouseTableAccess: { enforced: false },
		warehouseRowSecurity: { enforced: false },
		docsContextAccess: { enforced: false } as ToolContext['docsContextAccess'],
		filesContextAccess: { enforced: false } as ToolContext['filesContextAccess'],
		userGroupFeatures: [],
		userRulesGroupAccess: { enforced: false } as ToolContext['userRulesGroupAccess'],
		azureAccessToken: null,
		queryResults: new Map(),
		generatedArtifacts: { charts: [], maps: [], stories: [] },
	};
}
