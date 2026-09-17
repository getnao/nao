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

	it('allows database_id to be omitted or explicitly supplied for one warehouse', async () => {
		const client = await connect([{ id: 'analytics' }]);

		const omittedResult = await client.callTool({
			name: 'execute_sql',
			arguments: { sql_query: 'select 1' },
		});
		const explicitResult = await client.callTool({
			name: 'execute_sql',
			arguments: { sql_query: 'select 2', database_id: 'analytics' },
		});

		expect(omittedResult.isError).not.toBe(true);
		expect(explicitResult.isError).not.toBe(true);
		expect(testState.inputs).toEqual([
			{ sql_query: 'select 1' },
			{ sql_query: 'select 2', database_id: 'analytics' },
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
