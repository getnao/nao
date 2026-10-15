import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMcpProject } from '../helpers/mcp-project';

const mocks = vi.hoisted(() => ({ isCloud: false }));

vi.mock('../../src/env', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/env')>()),
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

vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock(
	'../../src/queries/project.queries',
	async () => (await import('../helpers/mcp-project')).mcpProjectQueriesMock,
);
vi.mock(
	'../../src/queries/mcp-oauth.queries',
	async () => (await import('../helpers/mcp-project')).mcpOAuthQueriesMock,
);

vi.mock('../../src/services/mcp-oauth', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/services/mcp-oauth')>()),
	isOAuthServer: async () => false,
}));

import { McpService, McpTransportNotAllowedError } from '../../src/services/mcp';

const MCP_SERVERS = {
	shell: { command: 'bash', args: ['-c', 'echo pwned'] },
	implicitStdio: { transport: 'stdio', command: 'node', args: ['server.js'] },
	remote: { transport: 'streamable-http', url: 'https://mcp.example.com/mcp' },
	events: { transport: 'sse', url: 'https://sse.example.com/mcp' },
	typed: { type: 'http', url: 'https://typed.example.com/mcp' },
};
const STDIO_SERVERS = ['shell', 'implicitStdio'];
const HTTP_SERVERS = ['remote', 'events', 'typed'];

const registeredStdioServers = (): string[] =>
	registeredDefinitions.filter((definition) => definition.command.kind === 'stdio').map((d) => d.name);

describe('MCP transports in cloud mode', () => {
	beforeEach(async () => {
		await setUpProject({ isCloud: true });
	});

	it('never registers a stdio server on the runtime during discovery', async () => {
		const service = await createInitializedService();
		await service.discover('project-1');

		expect(registeredStdioServers()).toEqual([]);
		expect(registeredDefinitions.map((definition) => definition.name).sort()).toEqual(HTTP_SERVERS.sort());
	});

	it('refuses to call a tool on a stdio server', async () => {
		const service = await createInitializedService();

		for (const server of STDIO_SERVERS) {
			await expect(
				service.callTool({ projectId: 'project-1', userId: 'user-1', server, tool: 'anything', args: {} }),
			).rejects.toBeInstanceOf(McpTransportNotAllowedError);
		}
		expect(registeredStdioServers()).toEqual([]);
	});

	it('refuses to connect a user to a stdio server', async () => {
		const service = await createInitializedService();

		await expect(
			service.connectForUser({ projectId: 'project-1', userId: 'user-1', server: 'shell' }),
		).rejects.toBeInstanceOf(McpTransportNotAllowedError);
		expect(registeredStdioServers()).toEqual([]);
	});

	it('blocks stdio even when a caller reaches the runtime registration directly', async () => {
		const service = await createInitializedService();
		const internals = service as unknown as { _ensureRegistered: (name: string) => Promise<unknown> };

		await expect(internals._ensureRegistered('shell')).rejects.toBeInstanceOf(McpTransportNotAllowedError);
		expect(registeredStdioServers()).toEqual([]);
	});

	it('hides stdio servers from the agent but keeps HTTP servers', async () => {
		const service = await createInitializedService();

		expect(service.getConfiguredServerNames().sort()).toEqual(HTTP_SERVERS.sort());
		expect((await service.getEnabledServers('project-1')).sort()).toEqual(HTTP_SERVERS.sort());
	});

	it('still lists stdio servers to admins, flagged with an explanatory error and no tools', async () => {
		const service = await createInitializedService();
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
		await setUpProject({ isCloud: false });
	});

	it('keeps stdio servers usable', async () => {
		const service = await createInitializedService();

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

async function setUpProject({ isCloud }: { isCloud: boolean }): Promise<void> {
	registeredDefinitions.length = 0;
	mocks.isCloud = isCloud;
	await createMcpProject(MCP_SERVERS);
}

async function createInitializedService(): Promise<McpService> {
	const service = new McpService();
	await service.initializeMcpState('project-1');
	return service;
}
