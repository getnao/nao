import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SemanticLayerMode } from '@nao/shared/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
	calls: [] as Array<{ input: unknown; chatId: string | null | undefined }>,
}));

vi.mock('../src/db/db', () => ({ db: {} }));

vi.mock('../src/mcp/tools/run-agent-tool', () => ({
	runAgentTool: async (_tool: unknown, input: unknown, _ctx: unknown, chatId?: string | null) => {
		testState.calls.push({ input, chatId });
		const sqlOutput = {
			_version: '1',
			columns: ['metric_time__month', 'revenue'],
			data: [{ metric_time__month: '2024-01-01', revenue: 42 }],
			id: 'query_semantic',
			row_count: 1,
		};
		const isSemanticQuery = typeof input === 'object' && input !== null && 'metrics' in input;
		return isSemanticQuery ? { ...sqlOutput, compiled_sql: 'select 1', database_id: 'analytics' } : sqlOutput;
	},
}));

vi.mock('../src/mcp/tools/helpers', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/mcp/tools/helpers')>()),
	resolveChartChatId: vi.fn(async (chatId?: string) => chatId ?? null),
}));

vi.mock('../src/queries/mcp-endpoint.queries', () => ({
	insertMcpCallLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/queries/mcp-query-data.queries', () => ({
	upsertMcpQueryData: vi.fn().mockResolvedValue(undefined),
}));

import { registerContextLayerTools } from '../src/mcp/tools/context-layer';
import { upsertMcpQueryData } from '../src/queries/mcp-query-data.queries';

const connections: Array<{ client: Client; server: McpServer }> = [];

afterEach(async () => {
	testState.calls = [];
	await Promise.all(connections.splice(0).map(({ client, server }) => Promise.all([client.close(), server.close()])));
	vi.clearAllMocks();
});

describe('MCP execute_semantic_query registration', () => {
	it.each<SemanticLayerMode>(['prioritized', 'exclusive'])('is exposed in %s mode', async (mode) => {
		const client = await connect(mode);

		expect(await toolNames(client)).toContain('execute_semantic_query');
	});

	it.each<[string, SemanticLayerMode | null]>([
		['the semantic layer is disabled', 'disabled'],
		['the project has no semantic layer', null],
	])('is not exposed when %s', async (_case, mode) => {
		const client = await connect(mode);

		expect(await toolNames(client)).not.toContain('execute_semantic_query');
		expect(await toolNames(client)).toContain('execute_sql');
	});

	it('passes the semantic query to the agent tool and returns a reusable query_id', async () => {
		const client = await connect('prioritized');

		const result = await client.callTool({
			name: 'execute_semantic_query',
			arguments: {
				metrics: ['revenue'],
				group_by: ['metric_time__month'],
				start_time: '2024-01-01',
				chat_id: 'chat-1',
			},
		});

		expect(result.isError).not.toBe(true);
		expect(testState.calls).toEqual([
			{
				input: { metrics: ['revenue'], group_by: ['metric_time__month'], start_time: '2024-01-01' },
				chatId: 'chat-1',
			},
		]);
		expect(result.structuredContent).toMatchObject({ query_id: 'query_semantic', database_id: 'analytics' });
		expect(result.structuredContent).not.toHaveProperty('compiled_sql');
		expect(resultText(result)).not.toContain('compiled_sql');
		expect(upsertMcpQueryData).toHaveBeenCalledWith(
			'query_semantic',
			expect.any(String),
			'project-1',
			['metric_time__month', 'revenue'],
			[{ metric_time__month: '2024-01-01', revenue: 42 }],
			{ sourceChatId: 'chat-1' },
		);
	});

	it('limits execute_sql to the local database in exclusive mode', async () => {
		const client = await connect('exclusive');
		const executeSql = (await client.listTools()).tools.find((tool) => tool.name === 'execute_sql');

		const warehouseResult = await client.callTool({
			name: 'execute_sql',
			arguments: { sql_query: 'select 1', database_id: 'analytics' },
		});
		const localResult = await client.callTool({
			name: 'execute_sql',
			arguments: { sql_query: 'select * from query_semantic', database_id: 'duckdb_local' },
		});

		expect(executeSql?.description).toContain('the warehouse is only reachable through execute_semantic_query');
		expect(executeSql?.inputSchema.required).toContain('database_id');
		expect(JSON.stringify(executeSql?.inputSchema)).not.toContain('"analytics"');
		expect(warehouseResult.isError).toBe(true);
		expect(localResult.isError).not.toBe(true);
		expect(testState.calls.map((call) => call.input)).toEqual([
			{ sql_query: 'select * from query_semantic', database_id: 'duckdb_local' },
		]);
	});

	it('keeps warehouse access for execute_sql in prioritized mode', async () => {
		const client = await connect('prioritized');
		const executeSql = (await client.listTools()).tools.find((tool) => tool.name === 'execute_sql');

		expect(executeSql?.description).not.toContain('only reachable through execute_semantic_query');
		expect(executeSql?.inputSchema.required ?? []).not.toContain('database_id');
	});

	it('rejects a query without metrics before running it', async () => {
		const client = await connect('prioritized');

		const result = await client.callTool({
			name: 'execute_semantic_query',
			arguments: { metrics: [] },
		});

		expect(result.isError).toBe(true);
		expect(testState.calls).toEqual([]);
	});
});

async function connect(semanticLayerMode: SemanticLayerMode | null): Promise<Client> {
	const server = new McpServer({ name: 'test', version: '0.0.0' });
	registerContextLayerTools(
		server,
		{
			userId: 'user-1',
			projectId: 'project-1',
			settings: {
				enabled: true,
				subAgentModeEnabled: false,
				contextLayerModeEnabled: true,
			},
			chartDataMode: false,
			storyCreationEnabled: false,
			customStoryCreationEnabled: false,
		},
		[{ id: 'analytics', type: 'bigquery' }],
		semanticLayerMode,
	);
	const client = new Client({ name: 'test-client', version: '0.0.0' });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	connections.push({ client, server });
	return client;
}

function resultText(result: Awaited<ReturnType<Client['callTool']>>): string {
	const content = result.content as Array<{ type: string; text?: string }> | undefined;
	return content?.map((item) => item.text ?? '').join('\n') ?? '';
}

async function toolNames(client: Client): Promise<string[]> {
	return (await client.listTools()).tools.map((tool) => tool.name);
}
