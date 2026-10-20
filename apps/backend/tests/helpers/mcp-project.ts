import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { useTemporaryFolders } from './temporary-folders';

let currentProjectPath = '';

/** Stands in for `src/queries/project.queries`, resolving every project to the last created MCP project folder. */
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

/** Returns a factory of project folders declaring `mcpServers`, all of them removed after each test. */
export function useMcpProject(): (mcpServers: Record<string, unknown>) => Promise<void> {
	const createTemporaryFolder = useTemporaryFolders();

	return async (mcpServers) => {
		const root = createTemporaryFolder('nao-mcp-');
		const mcpsDir = join(root, 'agent', 'mcps');
		await mkdir(mcpsDir, { recursive: true });
		await writeFile(join(mcpsDir, 'mcp.json'), JSON.stringify({ mcpServers }, null, 2), 'utf8');
		currentProjectPath = root;
	};
}
