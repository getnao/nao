import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/queries/project.queries', () => ({
	getCustomBoundaries: vi.fn().mockResolvedValue([]),
	getProjectById: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/services/user-group-feature-access.service', () => ({
	hasUserGroupFeature: vi.fn().mockResolvedValue(false),
}));

import { createMcpServer } from '../../src/mcp/server';
import type { McpUserRole } from '../../src/types/mcp-endpoint';

let client: Client | undefined;

afterEach(async () => {
	await client?.close();
	client = undefined;
});

describe('createMcpServer', () => {
	it.each<McpUserRole>(['admin', 'context_admin', 'user'])('offers the project skill tools to %s', async (role) => {
		const server = await createMcpServer(
			'user-1',
			'project-1',
			role,
			{ enabled: true, subAgentModeEnabled: false, contextLayerModeEnabled: false },
			false,
		);
		client = new Client({ name: 'test-client', version: '0.0.0' });
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

		const { tools } = await client.listTools();

		expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['list_nao_skills', 'get_nao_skill']));
	});
});
