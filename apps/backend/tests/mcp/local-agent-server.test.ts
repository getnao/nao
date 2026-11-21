import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { tool } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';

vi.mock('../../src/db/db', () => ({ db: {} }));

import { createLocalAgentMcpServer } from '../../src/mcp/local-agent-server';
import type { LocalAgentSession } from '../../src/services/local-agent-session';
import { createToolContext } from '../helpers/tool-context';

const QUERY_OUTPUT = { id: 'query_1', columns: ['orders'], data: [{ orders: 42 }] };

const executeSql = tool({
	description: 'Run SQL',
	inputSchema: z.object({ sql_query: z.string() }),
	execute: async ({ sql_query }) => {
		if (sql_query === 'fail') {
			throw new Error('The warehouse is unreachable.');
		}
		return QUERY_OUTPUT;
	},
	toModelOutput: ({ output }) => ({ type: 'text', value: `query ${output.id}: 1 row` }),
});

const clients: Client[] = [];

afterEach(async () => {
	await Promise.all(clients.splice(0).map((client) => client.close()));
});

function createSession(): LocalAgentSession {
	return {
		chat: { id: 'chat-1', userId: 'user-1', projectId: 'project-1' },
		tools: { execute_sql: executeSql },
		toolContext: createToolContext(),
		systemPrompt: '',
		recordedToolCalls: new Map(),
		lastUsedAt: Date.now(),
	};
}

async function connect(session: LocalAgentSession): Promise<Client> {
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await createLocalAgentMcpServer(session).connect(serverTransport);
	const client = new Client({ name: 'claude-code', version: '1.0.0' });
	await client.connect(clientTransport);
	clients.push(client);
	return client;
}

function callExecuteSql(client: Client, sqlQuery: string) {
	return client.callTool({
		name: 'execute_sql',
		arguments: { sql_query: sqlQuery },
		_meta: { 'claudecode/toolUseId': 'toolu_1' },
	});
}

describe('local agent MCP server', () => {
	it('lists the agent tools with a JSON schema clients accept', async () => {
		const client = await connect(createSession());

		const { tools } = await client.listTools();

		expect(tools).toEqual([
			expect.objectContaining({
				name: 'execute_sql',
				inputSchema: expect.objectContaining({ type: 'object', required: ['sql_query'] }),
			}),
		]);
		expect(tools[0].inputSchema).not.toHaveProperty('$schema');
	});

	it('gives the model the compact output and keeps the full one for the chat', async () => {
		const session = createSession();
		const client = await connect(session);

		const result = await callExecuteSql(client, 'select count(*) from orders');

		expect(result.content).toEqual([{ type: 'text', text: 'query query_1: 1 row' }]);
		expect(result._meta).toEqual({ 'nao/output': QUERY_OUTPUT });
		expect(session.recordedToolCalls.get('toolu_1')).toEqual({
			toolName: 'execute_sql',
			input: { sql_query: 'select count(*) from orders' },
			output: QUERY_OUTPUT,
		});
	});

	it('reports a failing tool as an error and records it', async () => {
		const session = createSession();
		const client = await connect(session);

		const result = await callExecuteSql(client, 'fail');

		expect(result).toMatchObject({
			isError: true,
			content: [{ type: 'text', text: 'The warehouse is unreachable.' }],
		});
		expect(session.recordedToolCalls.get('toolu_1')?.errorText).toBe('The warehouse is unreachable.');
	});

	it.each([
		['an unknown tool', { name: 'drop_database', arguments: {} }, 'Unknown tool: drop_database'],
		['an invalid input', { name: 'execute_sql', arguments: { sql_query: 1 } }, 'Invalid input for execute_sql'],
	])('refuses %s without running anything', async (_label, call, message) => {
		const session = createSession();
		const client = await connect(session);

		const result = await client.callTool(call);

		expect(result.isError).toBe(true);
		expect((result.content as Array<{ text: string }>)[0].text).toContain(message);
		expect(session.recordedToolCalls.size).toBe(0);
	});
});
