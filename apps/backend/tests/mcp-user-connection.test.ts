import { beforeEach, describe, expect, it, vi } from 'vitest';

import { McpUserConnections } from '../src/services/mcp-user-connection';

const mocks = vi.hoisted(() => {
	class UnauthorizedError extends Error {}
	return {
		UnauthorizedError,
		connect: vi.fn(),
		listTools: vi.fn(),
		callTool: vi.fn(),
		close: vi.fn(),
		clientInstances: 0,
		providerOptions: [] as Array<Record<string, unknown>>,
		transportArgs: [] as Array<{ url: unknown; opts: unknown }>,
	};
});

vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({ UnauthorizedError: mocks.UnauthorizedError }));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
	Client: class {
		connect = mocks.connect;
		listTools = mocks.listTools;
		callTool = mocks.callTool;
		close = mocks.close;
		constructor() {
			mocks.clientInstances += 1;
		}
	},
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
	StreamableHTTPClientTransport: class {
		constructor(url: unknown, opts: unknown) {
			mocks.transportArgs.push({ url, opts });
		}
	},
}));

vi.mock('../src/services/mcp-oauth-provider', () => ({
	McpOAuthProvider: class {
		constructor(options: Record<string, unknown>) {
			mocks.providerOptions.push(options);
		}
	},
}));

vi.mock('../src/services/mcp-oauth.service', () => ({
	mcpOAuthRedirectUri: () => 'https://nao.example.com/api/mcp-oauth/callback',
}));

const target = {
	userId: 'user-1',
	projectId: 'project-1',
	serverName: 'mixpanel',
	server: { url: new URL('https://mcp.example.com/mcp'), oauth: { dynamicRegistration: true } },
};

describe('McpUserConnections', () => {
	let connections: McpUserConnections;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.clientInstances = 0;
		mocks.providerOptions.length = 0;
		mocks.transportArgs.length = 0;
		mocks.connect.mockResolvedValue(undefined);
		mocks.close.mockResolvedValue(undefined);
		connections = new McpUserConnections();
	});

	describe('listTools', () => {
		it('connects with a per-user provider and maps the listed tools', async () => {
			mocks.listTools.mockResolvedValue({
				tools: [{ name: 'run_query', description: 'Runs a query', inputSchema: { type: 'object' } }],
			});

			const tools = await connections.listTools(target);

			expect(tools).toEqual([
				{ name: 'run_query', description: 'Runs a query', inputSchema: { type: 'object' } },
			]);
			expect(mocks.providerOptions[0]).toMatchObject({
				session: { userId: 'user-1', projectId: 'project-1', serverName: 'mixpanel' },
			});
			expect(mocks.transportArgs[0].url).toBe(target.server.url);
		});

		it('returns null when the user has not authorized the server', async () => {
			mocks.connect.mockRejectedValue(new mocks.UnauthorizedError('no token'));

			await expect(connections.listTools(target)).resolves.toBeNull();
		});

		it('propagates non-authorization connection errors', async () => {
			mocks.connect.mockRejectedValue(new Error('network down'));

			await expect(connections.listTools(target)).rejects.toThrow('network down');
		});
	});

	describe('callTool', () => {
		it('executes the tool through the user connection', async () => {
			mocks.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

			const result = await connections.callTool(target, 'run_query', { sql: 'select 1' });

			expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
			expect(mocks.callTool).toHaveBeenCalledWith({ name: 'run_query', arguments: { sql: 'select 1' } });
		});

		it('reuses a cached connection across listTools and callTool', async () => {
			mocks.listTools.mockResolvedValue({ tools: [] });
			mocks.callTool.mockResolvedValue('done');

			await connections.listTools(target);
			await connections.callTool(target, 'run_query', {});

			expect(mocks.clientInstances).toBe(1);
			expect(mocks.connect).toHaveBeenCalledTimes(1);
		});

		it('drops the connection on an authorization failure so the next call reconnects', async () => {
			mocks.listTools.mockResolvedValue({ tools: [] });
			await connections.listTools(target);

			mocks.callTool.mockRejectedValueOnce(new mocks.UnauthorizedError('expired'));
			await expect(connections.callTool(target, 'run_query', {})).rejects.toBeInstanceOf(mocks.UnauthorizedError);
			expect(mocks.close).toHaveBeenCalledTimes(1);

			mocks.callTool.mockResolvedValue('recovered');
			await connections.callTool(target, 'run_query', {});
			expect(mocks.clientInstances).toBe(2);
		});
	});

	describe('disconnect / closeAll', () => {
		it('closes a connection and reconnects on the next use', async () => {
			mocks.listTools.mockResolvedValue({ tools: [] });
			await connections.listTools(target);

			await connections.disconnect('user-1', 'mixpanel');
			expect(mocks.close).toHaveBeenCalledTimes(1);

			await connections.listTools(target);
			expect(mocks.clientInstances).toBe(2);
		});

		it('closeAll closes every cached connection', async () => {
			mocks.listTools.mockResolvedValue({ tools: [] });
			await connections.listTools(target);
			await connections.listTools({ ...target, userId: 'user-2' });

			await connections.closeAll();

			expect(mocks.close).toHaveBeenCalledTimes(2);
		});
	});
});
