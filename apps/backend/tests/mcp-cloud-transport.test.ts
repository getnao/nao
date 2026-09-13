import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isCloud: false }));

vi.mock('../src/env', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/env')>()),
	get isCloud() {
		return mocks.isCloud;
	},
}));

type Definition = { name: string; command: { kind: 'stdio' | 'http' } };
const registeredDefinitions: Definition[] = [];

class FakeRuntime {
	registerDefinition(definition: Definition): void {
		registeredDefinitions.push(definition);
	}

	async listTools(server: string): Promise<{ name: string; description: string; inputSchema: object }[]> {
		return [{ name: `${server}_tool`, description: 'a tool', inputSchema: { type: 'object' } }];
	}

	async callTool(): Promise<unknown> {
		return { ok: true };
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

import { McpService, McpTransportNotAllowedError } from '../src/services/mcp';

const MCP_SERVERS = {
	shell: { command: 'bash', args: ['-c', 'echo pwned'] },
	implicitStdio: { transport: 'stdio', command: 'node', args: ['server.js'] },
	remote: { transport: 'streamable-http', url: 'https://mcp.example.com/mcp' },
	events: { transport: 'sse', url: 'https://sse.example.com/mcp' },
	typed: { type: 'http', url: 'https://typed.example.com/mcp' },
};
const STDIO_SERVERS = ['shell', 'implicitStdio'];
const HTTP_SERVERS = ['remote', 'events', 'typed'];

async function createProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'nao-mcp-cloud-'));
	const mcpsDir = join(root, 'agent', 'mcps');
	await mkdir(mcpsDir, { recursive: true });
	await writeFile(join(mcpsDir, 'mcp.json'), JSON.stringify({ mcpServers: MCP_SERVERS }, null, 2), 'utf8');
	return root;
}

const registeredStdioServers = (): string[] =>
	registeredDefinitions.filter((definition) => definition.command.kind === 'stdio').map((d) => d.name);

describe('MCP transports in cloud mode', () => {
	beforeEach(async () => {
		registeredDefinitions.length = 0;
		mocks.isCloud = true;
		projectPath = await createProject();
	});

	it('never registers a stdio server on the runtime during discovery', async () => {
		const service = new McpService();
		await service.initializeMcpState('project-1');
		await service.discover('project-1');

		expect(registeredStdioServers()).toEqual([]);
		expect(registeredDefinitions.map((definition) => definition.name).sort()).toEqual(HTTP_SERVERS.sort());
	});

	it('refuses to call a tool on a stdio server', async () => {
		const service = new McpService();
		await service.initializeMcpState('project-1');

		for (const server of STDIO_SERVERS) {
			await expect(
				service.callTool({ projectId: 'project-1', userId: 'user-1', server, tool: 'anything', args: {} }),
			).rejects.toBeInstanceOf(McpTransportNotAllowedError);
		}
		expect(registeredStdioServers()).toEqual([]);
	});

	it('refuses to connect a user to a stdio server', async () => {
		const service = new McpService();
		await service.initializeMcpState('project-1');

		await expect(
			service.connectForUser({ projectId: 'project-1', userId: 'user-1', server: 'shell' }),
		).rejects.toBeInstanceOf(McpTransportNotAllowedError);
		expect(registeredStdioServers()).toEqual([]);
	});

	it('blocks stdio even when a caller reaches the runtime registration directly', async () => {
		const service = new McpService();
		await service.initializeMcpState('project-1');
		const internals = service as unknown as { _ensureRegistered: (name: string) => Promise<unknown> };

		await expect(internals._ensureRegistered('shell')).rejects.toBeInstanceOf(McpTransportNotAllowedError);
		expect(registeredStdioServers()).toEqual([]);
	});

	it('hides stdio servers from the agent but keeps HTTP servers', async () => {
		const service = new McpService();
		await service.initializeMcpState('project-1');

		expect(service.getConfiguredServerNames().sort()).toEqual(HTTP_SERVERS.sort());
		expect((await service.getEnabledServers('project-1')).sort()).toEqual(HTTP_SERVERS.sort());
	});

	it('still lists stdio servers to admins, flagged with an explanatory error and no tools', async () => {
		const service = new McpService();
		await service.initializeMcpState('project-1');
		const statuses = await service.getServersStatus('project-1');

		const blocked = statuses.filter((status) => STDIO_SERVERS.includes(status.name));
		expect(blocked).toHaveLength(STDIO_SERVERS.length);
		for (const status of blocked) {
			expect(status.transport).toBe('stdio');
			expect(status.connectionOk).toBe(false);
			expect(status.toolCount).toBe(0);
			expect(status.error).toMatch(/not available in cloud mode/);
		}

		const allowed = statuses.filter((status) => HTTP_SERVERS.includes(status.name));
		expect(allowed.every((status) => status.connectionOk && status.toolCount === 1)).toBe(true);
	});
});

describe('MCP transports in self-hosted mode', () => {
	beforeEach(async () => {
		registeredDefinitions.length = 0;
		mocks.isCloud = false;
		projectPath = await createProject();
	});

	it('keeps stdio servers usable', async () => {
		const service = new McpService();
		await service.initializeMcpState('project-1');

		expect(service.getConfiguredServerNames().sort()).toEqual(Object.keys(MCP_SERVERS).sort());
		await expect(
			service.callTool({
				projectId: 'project-1',
				userId: 'user-1',
				server: 'shell',
				tool: 'shell_tool',
				args: {},
			}),
		).resolves.toEqual({ ok: true });
		expect(registeredStdioServers().sort()).toEqual(STDIO_SERVERS.sort());
	});
});
