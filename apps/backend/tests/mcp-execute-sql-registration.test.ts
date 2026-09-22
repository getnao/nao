import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
	inputs: [] as unknown[],
}));

vi.mock('../src/db/db', () => ({ db: {} }));

vi.mock('../src/mcp/tools/run-agent-tool', () => ({
	runAgentTool: async (_tool: unknown, input: unknown) => {
		testState.inputs.push(input);
		return {
			_version: '1',
			columns: [],
			data: [],
			id: 'query_test',
			row_count: 0,
		};
	},
}));

vi.mock('../src/queries/mcp-endpoint.queries', () => ({
	insertMcpCallLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/queries/mcp-query-data.queries', () => ({
	upsertMcpQueryData: vi.fn().mockResolvedValue(undefined),
}));

import { registerContextLayerTools } from '../src/mcp/tools/context-layer';
import type { ConfiguredDatabase } from '../src/utils/nao-config';

const connections: Array<{ client: Client; server: McpServer }> = [];

afterEach(async () => {
	testState.inputs = [];
	await Promise.all(connections.splice(0).map(({ client, server }) => Promise.all([client.close(), server.close()])));
	vi.clearAllMocks();
});

describe('MCP execute_sql database selection', () => {
	it('lists configured database IDs and requires database_id for multiple warehouses', async () => {
		const client = await connect([
			{ id: 'analytics', type: 'bigquery' },
			{ id: 'finance', type: 'snowflake' },
		]);

		const executeSql = (await client.listTools()).tools.find((tool) => tool.name === 'execute_sql');

		expect(executeSql?.description).toContain('`database_id` is required');
		expect(executeSql?.description).toContain('"analytics", "finance", "duckdb_local"');
		expect(executeSql?.inputSchema.properties?.database_id).toMatchObject({
			enum: ['analytics', 'finance', 'duckdb_local'],
		});
		expect(executeSql?.inputSchema.required).toContain('database_id');
	});

	it('returns valid database IDs when database_id is missing for multiple warehouses', async () => {
		const client = await connect([{ id: 'analytics' }, { id: 'finance' }]);

		const result = await client.callTool({
			name: 'execute_sql',
			arguments: { sql_query: 'select 1' },
		});

		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain(
			'database_id is required when multiple warehouse databases are configured',
		);
		expect(resultText(result)).toContain('analytics');
		expect(resultText(result)).toContain('finance');
		expect(resultText(result)).toContain('duckdb_local');
		expect(testState.inputs).toEqual([]);
	});

	it('returns valid database IDs when database_id is unknown', async () => {
		const client = await connect([{ id: 'analytics' }, { id: 'finance' }]);

		const result = await client.callTool({
			name: 'execute_sql',
			arguments: { sql_query: 'select 1', database_id: 'missing' },
		});

		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain('Unknown database_id');
		expect(resultText(result)).toContain('analytics');
		expect(resultText(result)).toContain('finance');
		expect(resultText(result)).toContain('duckdb_local');
		expect(testState.inputs).toEqual([]);
	});

	it('allows only the configured warehouse and duckdb_local when one warehouse exists', async () => {
		const client = await connect([{ id: 'analytics' }]);
		const executeSql = (await client.listTools()).tools.find((tool) => tool.name === 'execute_sql');

		const omittedResult = await client.callTool({
			name: 'execute_sql',
			arguments: { sql_query: 'select 1' },
		});
		const explicitResult = await client.callTool({
			name: 'execute_sql',
			arguments: { sql_query: 'select 2', database_id: 'analytics' },
		});
		const localResult = await client.callTool({
			name: 'execute_sql',
			arguments: { sql_query: 'select 3', database_id: 'duckdb_local' },
		});
		const typoResult = await client.callTool({
			name: 'execute_sql',
			arguments: { sql_query: 'select 4', database_id: 'analytcis' },
		});

		expect(executeSql?.description).not.toContain('analytics');
		expect(JSON.stringify(executeSql?.inputSchema)).not.toContain('analytics');
		expect(executeSql?.inputSchema.properties?.database_id).not.toHaveProperty('enum');
		expect(executeSql?.inputSchema.required ?? []).not.toContain('database_id');
		expect(omittedResult.isError).not.toBe(true);
		expect(explicitResult.isError).not.toBe(true);
		expect(localResult.isError).not.toBe(true);
		expect(typoResult.isError).toBe(true);
		expect(resultText(typoResult)).toContain('Unknown database_id');
		expect(resultText(typoResult)).not.toContain('analytics');
		expect(testState.inputs).toEqual([
			{ sql_query: 'select 1' },
			{ sql_query: 'select 2', database_id: 'analytics' },
			{ sql_query: 'select 3', database_id: 'duckdb_local' },
		]);
	});

	it('allows only omission and duckdb_local when no warehouse is configured', async () => {
		const noWarehouseClient = await connect([]);
		const oneWarehouseClient = await connect([{ id: 'analytics' }]);

		const noWarehouseTool = (await noWarehouseClient.listTools()).tools.find((tool) => tool.name === 'execute_sql');
		const oneWarehouseTool = (await oneWarehouseClient.listTools()).tools.find(
			(tool) => tool.name === 'execute_sql',
		);
		const omittedResult = await noWarehouseClient.callTool({
			name: 'execute_sql',
			arguments: { sql_query: 'select 1' },
		});
		const localResult = await noWarehouseClient.callTool({
			name: 'execute_sql',
			arguments: { sql_query: 'select 2', database_id: 'duckdb_local' },
		});
		const arbitraryResult = await noWarehouseClient.callTool({
			name: 'execute_sql',
			arguments: { sql_query: 'select 3', database_id: 'analytics' },
		});

		expect(noWarehouseTool?.description).toBe(oneWarehouseTool?.description);
		expect(noWarehouseTool?.description).not.toContain('Database selection');
		expect(noWarehouseTool?.inputSchema.properties?.database_id).not.toHaveProperty('enum');
		expect(noWarehouseTool?.inputSchema.required ?? []).not.toContain('database_id');
		expect(omittedResult.isError).not.toBe(true);
		expect(localResult.isError).not.toBe(true);
		expect(arbitraryResult.isError).toBe(true);
		expect(resultText(arbitraryResult)).toContain('Unknown database_id');
		expect(testState.inputs).toEqual([
			{ sql_query: 'select 1' },
			{ sql_query: 'select 2', database_id: 'duckdb_local' },
		]);
	});

	it('accepts duckdb_local as an explicit database ID', async () => {
		const client = await connect([{ id: 'analytics' }, { id: 'finance' }]);

		const result = await client.callTool({
			name: 'execute_sql',
			arguments: { sql_query: 'select * from query_test', database_id: 'duckdb_local' },
		});

		expect(result.isError).not.toBe(true);
		expect(testState.inputs).toEqual([{ sql_query: 'select * from query_test', database_id: 'duckdb_local' }]);
	});
});

async function connect(configuredDatabases: ConfiguredDatabase[]): Promise<Client> {
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
		},
		configuredDatabases,
	);
	const client = new Client({ name: 'test-client', version: '0.0.0' });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	connections.push({ client, server });
	return client;
}

function resultText(result: Awaited<ReturnType<Client['callTool']>>): string {
	return result.content
		.filter((part): part is { type: 'text'; text: string } => part.type === 'text')
		.map((part) => part.text)
		.join('\n');
}
