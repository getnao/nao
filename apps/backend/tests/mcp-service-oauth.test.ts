import { beforeEach, describe, expect, it, vi } from 'vitest';

import { McpService } from '../src/services/mcp';

const mocks = vi.hoisted(() => ({
	createRuntime: vi.fn(),
	registerDefinition: vi.fn(),
	runtimeListTools: vi.fn(),
	runtimeCallTool: vi.fn(),
	mgrListTools: vi.fn(),
	mgrCallTool: vi.fn(),
	mgrCloseAll: vi.fn(),
	mgrDisconnect: vi.fn(),
	getEnabledToolsAndKnownServers: vi.fn(),
	updateEnabledToolsAndKnownServers: vi.fn(),
	retrieveProjectById: vi.fn(),
	readFileSync: vi.fn(),
	existsSync: vi.fn(),
	watch: vi.fn(),
}));

vi.mock('mcporter', () => ({ createRuntime: mocks.createRuntime }));

vi.mock('../src/services/mcp-user-connection', () => ({
	McpUserConnections: class {
		listTools = mocks.mgrListTools;
		callTool = mocks.mgrCallTool;
		closeAll = mocks.mgrCloseAll;
		disconnect = mocks.mgrDisconnect;
	},
}));

vi.mock('../src/queries/project.queries', () => ({
	retrieveProjectById: mocks.retrieveProjectById,
	getEnabledToolsAndKnownServers: mocks.getEnabledToolsAndKnownServers,
	updateEnabledToolsAndKnownServers: mocks.updateEnabledToolsAndKnownServers,
}));

vi.mock('../src/utils/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

vi.mock('fs', async (importActual) => ({
	...(await importActual<typeof import('fs')>()),
	existsSync: mocks.existsSync,
	readFileSync: mocks.readFileSync,
	watch: mocks.watch,
}));

const CONFIG = {
	mcpServers: {
		local_stdio: { command: 'node', args: ['server.js'] },
		headered: {
			transport: 'streamable-http',
			url: 'https://hdr.example.com/mcp',
			headers: { Authorization: 'Bearer static' },
		},
		mixpanel: {
			transport: 'streamable-http',
			url: 'https://mcp.example.com/mcp',
			oauth: { dynamicRegistration: true },
		},
	},
};

async function initService(): Promise<McpService> {
	const service = new McpService();
	await service.initializeMcpState('project-1');
	return service;
}

describe('McpService OAuth routing', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createRuntime.mockResolvedValue({
			registerDefinition: mocks.registerDefinition,
			listTools: mocks.runtimeListTools,
			callTool: mocks.runtimeCallTool,
		});
		mocks.runtimeListTools.mockResolvedValue([
			{ name: 'do_thing', description: 'Does a thing', inputSchema: { type: 'object' } },
		]);
		mocks.mgrListTools.mockResolvedValue(null);
		mocks.mgrCloseAll.mockResolvedValue(undefined);
		mocks.mgrDisconnect.mockResolvedValue(undefined);
		mocks.getEnabledToolsAndKnownServers.mockResolvedValue({ enabledTools: [], knownServers: [] });
		mocks.updateEnabledToolsAndKnownServers.mockResolvedValue(undefined);
		mocks.retrieveProjectById.mockResolvedValue({ path: '/projects/p1' });
		mocks.existsSync.mockReturnValue(true);
		mocks.readFileSync.mockReturnValue(JSON.stringify(CONFIG));
		mocks.watch.mockReturnValue({ close: vi.fn() });
	});

	it('registers stdio and static-header servers with mcporter but not OAuth servers', async () => {
		await initService();

		const registeredNames = mocks.registerDefinition.mock.calls.map((call) => call[0].name);
		expect(registeredNames).toEqual(expect.arrayContaining(['local_stdio', 'headered']));
		expect(registeredNames).not.toContain('mixpanel');
		expect(registeredNames).toHaveLength(2);

		const listedServers = mocks.runtimeListTools.mock.calls.map((call) => call[0]);
		expect(listedServers).not.toContain('mixpanel');
	});

	it('exposes only mcporter tools when no user is provided', async () => {
		const service = await initService();

		const tools = service.getMcpTools();
		expect(Object.keys(tools).sort()).toEqual(['headered__do_thing', 'local_stdio__do_thing']);
	});

	it('lists an OAuth server with no tools until a user connects', async () => {
		const service = await initService();

		expect(service.cachedMcpState.mixpanel).toEqual({ tools: [], error: undefined });
	});

	it('adds a user’s OAuth tools after connecting, scoped to that user', async () => {
		mocks.mgrListTools.mockResolvedValue([
			{ name: 'run_query', description: 'Runs', inputSchema: { type: 'object' } },
		]);
		const service = await initService();

		await service.connectUserOAuthServers('user-1', 'project-1');

		expect(Object.keys(service.getMcpTools(null, 'user-1'))).toContain('mixpanel__run_query');
		expect(Object.keys(service.getMcpTools(null, 'user-2'))).not.toContain('mixpanel__run_query');
		expect(service.cachedMcpState.mixpanel.tools.map((t) => t.name)).toEqual(['mixpanel__run_query']);
	});

	it('routes OAuth tool execution through the user connection with the original tool name', async () => {
		mocks.mgrListTools.mockResolvedValue([
			{ name: 'run_query', description: 'Runs', inputSchema: { type: 'object' } },
		]);
		mocks.mgrCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
		const service = await initService();
		await service.connectUserOAuthServers('user-1', 'project-1');

		const execute = service.getMcpTools(null, 'user-1')['mixpanel__run_query'].execute as (
			args: Record<string, unknown>,
			options: unknown,
		) => Promise<unknown>;
		const result = await execute({ sql: 'select 1' }, {});

		expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
		expect(mocks.mgrCallTool).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'user-1', projectId: 'project-1', serverName: 'mixpanel' }),
			'run_query',
			{ sql: 'select 1' },
		);
	});

	it('is a no-op when there are no OAuth servers configured', async () => {
		mocks.readFileSync.mockReturnValue(
			JSON.stringify({ mcpServers: { local_stdio: { command: 'node', args: [] } } }),
		);
		const service = await initService();

		await service.connectUserOAuthServers('user-1', 'project-1');

		expect(mocks.mgrListTools).not.toHaveBeenCalled();
	});

	it('exposes the configured OAuth server names', async () => {
		const service = await initService();

		expect(service.getOAuthServerNames()).toEqual(['mixpanel']);
	});

	it('drops a user’s OAuth tools and connection on disconnect', async () => {
		mocks.mgrListTools.mockResolvedValue([
			{ name: 'run_query', description: 'Runs', inputSchema: { type: 'object' } },
		]);
		const service = await initService();
		await service.connectUserOAuthServers('user-1', 'project-1');
		expect(Object.keys(service.getMcpTools(null, 'user-1'))).toContain('mixpanel__run_query');

		await service.disconnectUserOAuthServer('user-1', 'mixpanel');

		expect(mocks.mgrDisconnect).toHaveBeenCalledWith('user-1', 'mixpanel');
		expect(Object.keys(service.getMcpTools(null, 'user-1'))).not.toContain('mixpanel__run_query');
	});
});
