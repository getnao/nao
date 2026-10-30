import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { McpAccess } from '@nao/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeRuntime {
	registerDefinition(): void {}

	async listTools(): Promise<{ name: string; description: string; inputSchema: object }[]> {
		return [
			{ name: 'search', description: 'search', inputSchema: { type: 'object' } },
			{ name: 'write', description: 'write', inputSchema: { type: 'object' } },
		];
	}
}

vi.mock('mcporter', () => ({
	createRuntime: async () => new FakeRuntime(),
}));

vi.mock('../src/db/db', () => ({ db: {} }));

let projectPath = '';

vi.mock('../src/queries/project.queries', () => ({
	retrieveProjectById: async () => ({ path: projectPath }),
	getDisabledMcpServers: async () => [],
	getDisabledMcpTools: async () => [],
	getEnvVars: async () => ({}),
}));

vi.mock('../src/queries/mcp-oauth.queries', () => ({
	claimMcpDiscoveryUser: async () => false,
	deleteMcpUserToken: async () => undefined,
	getMcpOAuthClient: async () => null,
	hasMcpUserToken: async () => false,
}));

vi.mock('../src/services/mcp-oauth', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/services/mcp-oauth')>()),
	isOAuthServer: async () => false,
}));

import { McpService } from '../src/services/mcp';

const MCP_SERVERS = {
	github: { transport: 'streamable-http', url: 'https://github.example.com/mcp' },
	linear: { transport: 'streamable-http', url: 'https://linear.example.com/mcp' },
	notion: { transport: 'streamable-http', url: 'https://notion.example.com/mcp' },
};

const GROUP_ACCESS: McpAccess = {
	mode: 'restricted',
	grants: [
		{ kind: 'server', server: 'linear' },
		{ kind: 'tool', server: 'github', tool: 'search' },
	],
};

async function createProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'nao-mcp-user-group-'));
	const mcpsDir = join(root, 'agent', 'mcps');
	await mkdir(mcpsDir, { recursive: true });
	await writeFile(join(mcpsDir, 'mcp.json'), JSON.stringify({ mcpServers: MCP_SERVERS }, null, 2), 'utf8');
	return root;
}

describe('MCP access scoped by user groups', () => {
	beforeEach(async () => {
		projectPath = await createProject();
	});

	it('only lists the granted servers and tools', async () => {
		const service = new McpService();
		await service.initializeMcpState('project-1');

		expect(await service.getEnabledServers('project-1', GROUP_ACCESS)).toEqual(['github', 'linear']);
		expect(await service.getEnabledServers('project-1')).toEqual(['github', 'linear', 'notion']);

		const statuses = await service.getServersStatus('project-1', 'user-1', GROUP_ACCESS);
		expect(statuses.map((status) => status.name)).toEqual(['github', 'linear']);
		expect(statuses.find((status) => status.name === 'github')?.tools.map((tool) => tool.name)).toEqual(['search']);
		expect(statuses.find((status) => status.name === 'linear')?.tools.map((tool) => tool.name)).toEqual([
			'search',
			'write',
		]);
	});

	it('only exposes the granted tools as callable', async () => {
		const service = new McpService();
		await service.initializeMcpState('project-1');

		expect(await service.getCallableTools('project-1', null, GROUP_ACCESS)).toEqual([
			{ server: 'github', tools: ['search'] },
			{ server: 'linear', tools: ['search', 'write'] },
		]);
		expect(await service.getCallableTools('project-1', ['linear'], GROUP_ACCESS)).toEqual([
			{ server: 'linear', tools: ['search', 'write'] },
		]);
	});

	it('refuses to connect a server the user groups do not grant and filters the connected tools', async () => {
		const service = new McpService();
		const connect = (server: string) =>
			service.connectForUser({ projectId: 'project-1', userId: 'user-1', server, access: GROUP_ACCESS });

		await expect(connect('notion')).rejects.toThrow('MCP server "notion" is not available for your user group.');
		await expect(connect('github')).resolves.toEqual(['search']);
	});

	it('refuses to call a tool the user groups do not grant', async () => {
		const service = new McpService();
		const call = (server: string, tool: string) =>
			service.callTool({
				projectId: 'project-1',
				userId: 'user-1',
				server,
				tool,
				args: {},
				access: GROUP_ACCESS,
			});

		await expect(call('notion', 'search')).rejects.toThrow(
			'MCP server "notion" is not available for your user group.',
		);
		await expect(call('github', 'write')).rejects.toThrow(
			'MCP tool "write" on server "github" is not available for your user group.',
		);
	});
});
