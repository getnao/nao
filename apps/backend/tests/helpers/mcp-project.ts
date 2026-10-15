import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let currentProjectPath = '';

/** Stands in for `src/queries/project.queries`, resolving every project to the last `createMcpProject` folder. */
export const mcpProjectQueriesMock = {
	retrieveProjectById: async () => ({ path: currentProjectPath }),
	getDisabledMcpServers: async () => [],
	getDisabledMcpTools: async () => [],
	getEnvVars: async () => ({}),
};

export const mcpOAuthQueriesMock = {
	claimMcpDiscoveryUser: async () => false,
	deleteMcpUserToken: async () => undefined,
	getMcpOAuthClient: async () => null,
	hasMcpUserToken: async () => false,
};

export async function createMcpProject(mcpServers: Record<string, unknown>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), 'nao-mcp-'));
	const mcpsDir = join(root, 'agent', 'mcps');
	await mkdir(mcpsDir, { recursive: true });
	await writeFile(join(mcpsDir, 'mcp.json'), JSON.stringify({ mcpServers }, null, 2), 'utf8');
	currentProjectPath = root;
}
