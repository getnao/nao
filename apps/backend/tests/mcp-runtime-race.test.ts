import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createdRuntimes: FakeRuntime[] = [];

class FakeRuntime {
	public readonly definitions = new Map<string, { name: string }>();

	registerDefinition(definition: { name: string }): void {
		this.definitions.set(definition.name, definition);
	}

	async listTools(server: string): Promise<{ name: string; description: string; inputSchema: object }[]> {
		this._assertKnown(server);
		return [{ name: `${server}_tool`, description: 'a tool', inputSchema: { type: 'object' } }];
	}

	async callTool(server: string): Promise<unknown> {
		this._assertKnown(server);
		return { ok: true };
	}

	private _assertKnown(server: string): void {
		if (!this.definitions.has(server)) {
			throw new Error(`Unknown MCP server '${server}'.`);
		}
	}
}

/** Set to hold every `createRuntime()` call open until the test releases it by index. */
const creationGates: (() => void)[] = [];
let gateCreations = false;

vi.mock('mcporter', () => ({
	createRuntime: async () => {
		const runtime = new FakeRuntime();
		createdRuntimes.push(runtime);
		if (gateCreations) {
			await new Promise<void>((resolve) => creationGates.push(resolve));
		}
		return runtime;
	},
}));

vi.mock('../src/db/db', () => ({ db: {} }));

const loggingMocks = vi.hoisted(() => ({
	insertMcpCallLog: vi.fn<() => Promise<void>>(async () => undefined),
}));

vi.mock('../src/queries/mcp-endpoint.queries', () => ({
	insertMcpCallLog: loggingMocks.insertMcpCallLog,
}));

let projectPath = '';

vi.mock('../src/queries/project.queries', () => ({
	retrieveProjectById: async () => ({ path: projectPath }),
	getDisabledMcpServers: async () => [],
	getDisabledMcpTools: async () => [],
}));

vi.mock('../src/queries/mcp-oauth.queries', () => ({
	claimMcpDiscoveryUser: async () => false,
	deleteMcpUserToken: async () => undefined,
	getMcpOAuthClient: async () => null,
	hasMcpUserToken: async () => false,
}));

import { McpService } from '../src/services/mcp';
import * as mcpOAuthService from '../src/services/mcp-oauth';
import { withLogging } from '../src/mcp/logging';

const SERVERS = ['alpha', 'beta', 'gamma'];

async function createProjectWithServers(
	mcpServers: Record<string, object> = Object.fromEntries(
		SERVERS.map((name) => [name, { command: 'node', args: ['-e', 'process.exit(0)'] }]),
	),
): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'nao-mcp-race-'));
	const mcpsDir = join(root, 'agent', 'mcps');
	await mkdir(mcpsDir, { recursive: true });
	await writeFile(join(mcpsDir, 'mcp.json'), JSON.stringify({ mcpServers }, null, 2), 'utf8');
	return root;
}

describe('MCP concurrent discovery (issue #1292)', () => {
	beforeEach(async () => {
		createdRuntimes.length = 0;
		creationGates.length = 0;
		gateCreations = false;
		projectPath = await createProjectWithServers();
	});

	it('shares a single runtime across parallel discovery', async () => {
		const service = new McpService();

		await service.initializeMcpState('project-1');
		const statuses = await service.getServersStatus('project-1');

		expect(createdRuntimes).toHaveLength(1);
		expect(statuses.filter((status) => !status.connectionOk).map((status) => status.error)).toEqual([]);
	});

	it('can call a tool on every server after discovery', async () => {
		const service = new McpService();
		await service.initializeMcpState('project-1');

		const results = await Promise.allSettled(
			SERVERS.map((server) =>
				service.callTool({
					projectId: 'project-1',
					userId: 'user-1',
					server,
					tool: `${server}_tool`,
					args: {},
				}),
			),
		);

		expect(results.filter((result) => result.status === 'rejected')).toEqual([]);
	});

	it('rejects static MCP credentials when per-user OAuth is required', async () => {
		projectPath = await createProjectWithServers({
			static: {
				type: 'http',
				url: 'https://mcp.example.com',
				headers: { Authorization: 'Bearer shared-token' },
			},
		});
		const oauthDiscovery = vi.spyOn(mcpOAuthService, 'isOAuthServer').mockResolvedValue(true);
		const service = new McpService();
		await service.initializeMcpState('project-1');

		await expect(service.getServersStatus('project-1')).resolves.toEqual([
			expect.objectContaining({ name: 'static', transport: 'http', oauth: false }),
		]);
		await expect(
			service.callTool({
				projectId: 'project-1',
				userId: 'user-1',
				server: 'static',
				tool: 'static_tool',
				args: {},
			}),
		).resolves.toEqual({ ok: true });
		await expect(
			service.callTool({
				projectId: 'project-1',
				userId: 'user-1',
				server: 'static',
				tool: 'static_tool',
				args: {},
				requireUserOAuth: true,
			}),
		).rejects.toThrow('must use per-user OAuth');
		expect(oauthDiscovery).not.toHaveBeenCalled();
	});

	it('keeps every server callable when a reload lands mid-creation', async () => {
		const service = new McpService();
		await service.initializeMcpState('project-1');

		const internals = service as unknown as {
			_ensureRegistered: (name: string) => Promise<unknown>;
			_resetRuntime: () => void;
		};

		gateCreations = true;
		internals._resetRuntime();
		const beforeReload = internals._ensureRegistered('alpha');
		await waitForCreations(1);

		internals._resetRuntime();
		const afterReload = internals._ensureRegistered('beta');
		await waitForCreations(2);

		creationGates[1]();
		creationGates[0]();
		await Promise.all([beforeReload, afterReload]);
		gateCreations = false;

		const results = await Promise.allSettled(
			SERVERS.map((server) =>
				service.callTool({
					projectId: 'project-1',
					userId: 'user-1',
					server,
					tool: `${server}_tool`,
					args: {},
				}),
			),
		);

		expect(results.filter((result) => result.status === 'rejected')).toEqual([]);
	});

	it('waits for the call log before returning a tool result', async () => {
		let releaseLog: (() => void) | undefined;
		loggingMocks.insertMcpCallLog.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					releaseLog = resolve;
				}),
		);
		const handler = withLogging(
			'execute_sql',
			{
				projectId: 'project-1',
				userId: 'user-1',
				settings: {
					enabled: true,
					subAgentModeEnabled: false,
					contextLayerModeEnabled: true,
				},
				chartDataMode: false,
			},
			async () => ({ content: [{ type: 'text', text: 'done' }] }),
		);
		let returned = false;

		const result = handler({}, {} as never).then(() => {
			returned = true;
		});
		await vi.waitFor(() => expect(releaseLog).toBeDefined());

		expect(returned).toBe(false);
		releaseLog?.();
		await result;
		expect(returned).toBe(true);
	});
});

async function waitForCreations(count: number): Promise<void> {
	while (creationGates.length < count) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}
