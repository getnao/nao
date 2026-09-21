import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import zodV3 from 'zod/v3';

import { stripToolSchemaDialects, withoutJsonSchemaDialect } from '../src/mcp/tool-schema-dialect';

describe('MCP tool schema dialect', () => {
	it('drops the draft-07 $schema from listed tool schemas', async () => {
		const server = new McpServer({ name: 'test', version: '0.0.0' });
		server.registerTool(
			'zod_v4_tool',
			{ inputSchema: { query: z.string() }, outputSchema: { rows: z.array(z.string()) } },
			async () => ({ content: [], structuredContent: { rows: [] } }),
		);
		server.registerTool(
			'zod_v3_tool',
			{ inputSchema: { path: zodV3.string() }, outputSchema: zodV3.object({ text: zodV3.string() }) },
			async () => ({ content: [], structuredContent: { text: '' } }),
		);

		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await server.connect(withoutJsonSchemaDialect(serverTransport));
		const client = new Client({ name: 'test-client', version: '0.0.0' });
		await client.connect(clientTransport);

		const { tools } = await client.listTools();

		expect(tools).toHaveLength(2);
		for (const tool of tools) {
			expect(tool.inputSchema).not.toHaveProperty('$schema');
			expect(tool.outputSchema).not.toHaveProperty('$schema');
			expect(tool.inputSchema.properties).toBeDefined();
			expect(tool.outputSchema?.properties).toBeDefined();
		}
	});

	it('leaves non tools/list messages untouched', () => {
		const message = { jsonrpc: '2.0' as const, id: 1, result: { content: [], $schema: 'x' } };
		expect(stripToolSchemaDialects(message)).toBe(message);
	});
});
