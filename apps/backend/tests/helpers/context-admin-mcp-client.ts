import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach } from 'vitest';

import { registerContextAdminTools } from '../../src/mcp/tools/context-admin-tools';
import type { McpUserRole } from '../../src/types/mcp-endpoint';

/** Registered next to the context admin tools, like the tools of the other modes. */
export const BASELINE_TOOL = 'baseline';

/** Connects a client to an MCP server holding the context admin tools for `user-1` on `project-1`. */
export function useContextAdminMcpClient(): (role: McpUserRole) => Promise<Client> {
	const connections: Array<{ client: Client; server: McpServer }> = [];

	afterEach(async () => {
		await Promise.all(
			connections.splice(0).map(({ client, server }) => Promise.all([client.close(), server.close()])),
		);
	});

	return async (role) => {
		const server = new McpServer({ name: 'test', version: '0.0.0' });
		server.registerTool(BASELINE_TOOL, { description: 'Always registered.' }, () => ({ content: [] }));
		registerContextAdminTools(server, {
			userId: 'user-1',
			projectId: 'project-1',
			role,
			settings: { enabled: true, subAgentModeEnabled: true, contextLayerModeEnabled: true },
			chartDataMode: false,
			storyCreationEnabled: true,
			customStoryCreationEnabled: false,
		});
		const client = new Client({ name: 'test-client', version: '0.0.0' });
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
		connections.push({ client, server });
		return client;
	};
}

export async function listToolNames(client: Client): Promise<string[]> {
	const { tools } = await client.listTools();
	return tools.map((tool) => tool.name);
}
