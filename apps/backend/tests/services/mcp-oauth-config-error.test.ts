import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTemporaryFolders } from '../helpers/temporary-folders';

class FakeRuntime {
	registerDefinition(): void {}

	async listTools(server: string): Promise<{ name: string; description: string; inputSchema: object }[]> {
		return [{ name: `${server}_tool`, description: 'a tool', inputSchema: { type: 'object' } }];
	}
}

vi.mock('mcporter', () => ({
	createRuntime: async () => new FakeRuntime(),
}));

vi.mock('../../src/db/db', () => ({ db: {} }));

let projectPath = '';

vi.mock('../../src/queries/project.queries', () => ({
	retrieveProjectById: async () => ({ path: projectPath }),
	getDisabledMcpServers: async () => [],
	getDisabledMcpTools: async () => [],
	getEnvVars: async () => ({ NAO_TEST_SET_CLIENT_ID: 'configured-client' }),
}));

vi.mock('../../src/queries/mcp-oauth.queries', () => ({
	claimMcpDiscoveryUser: async () => false,
	deleteMcpUserToken: async () => undefined,
	getMcpOAuthClient: async () => null,
	hasMcpUserToken: async () => false,
}));

vi.mock('../../src/services/mcp-oauth', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/services/mcp-oauth')>()),
	isOAuthServer: async () => false,
}));

import { McpOAuthConfigError, McpService } from '../../src/services/mcp';

const MCP_SERVERS = {
	unset: {
		transport: 'streamable-http',
		url: 'https://unset.example.com/mcp',
		oauth: { clientId: '${NAO_TEST_UNSET_CLIENT_ID}' },
	},
	configured: {
		transport: 'streamable-http',
		url: 'https://configured.example.com/mcp',
		oauth: { clientId: '${NAO_TEST_SET_CLIENT_ID}' },
	},
	plain: { transport: 'streamable-http', url: 'https://plain.example.com/mcp' },
	withHeaders: {
		transport: 'streamable-http',
		url: 'https://headers.example.com/mcp',
		headers: { 'x-api-key': 'shared-key' },
		oauth: { clientId: '${NAO_TEST_SET_CLIENT_ID}' },
	},
};

const createTemporaryFolder = useTemporaryFolders();

async function createProject(): Promise<string> {
	const root = createTemporaryFolder('nao-mcp-oauth-config-');
	const mcpsDir = join(root, 'agent', 'mcps');
	await mkdir(mcpsDir, { recursive: true });
	await writeFile(join(mcpsDir, 'mcp.json'), JSON.stringify({ mcpServers: MCP_SERVERS }, null, 2), 'utf8');
	return root;
}

describe('OAuth client with an unset environment variable', () => {
	beforeEach(async () => {
		projectPath = await createProject();
	});

	it('keeps the rest of mcp.json valid', async () => {
		const service = new McpService();

		expect(await service.getConfigError('project-1')).toBeNull();
		expect(service.getConfiguredServerNames().sort()).toEqual(Object.keys(MCP_SERVERS).sort());
	});

	it('reports the missing variable on the affected server only', async () => {
		const service = new McpService();
		const statuses = await service.getServersStatus('project-1');
		const errorOf = (name: string) => statuses.find((status) => status.name === name)?.error;

		expect(errorOf('unset')).toMatch(/NAO_TEST_UNSET_CLIENT_ID/);
		expect(errorOf('configured') ?? '').not.toMatch(/to be set/);
		expect(errorOf('plain')).toBeUndefined();
	});

	it('refuses to start the OAuth flow with the unresolved placeholder', async () => {
		const service = new McpService();

		await expect(service.getServerOAuthClient('project-1', 'unset')).rejects.toBeInstanceOf(McpOAuthConfigError);
		await expect(service.getServerOAuthClient('project-1', 'configured')).resolves.toEqual({
			clientId: 'configured-client',
		});
	});

	it('treats a server as OAuth when it declares an oauth block next to static auth headers', async () => {
		const service = new McpService();
		const statuses = await service.getServersStatus('project-1');

		expect(statuses.find((status) => status.name === 'withHeaders')?.oauth).toBe(true);
	});
});
