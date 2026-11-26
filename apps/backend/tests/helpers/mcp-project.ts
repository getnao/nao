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

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

/** Every MCP SDK HTTP transport the service built, recorded by the fake transports below. Reset it in each test. */
export const builtHttpTransports: { url: URL; options: { requestInit?: RequestInit; fetch?: FetchLike } }[] = [];

class FakeHttpTransport {
	constructor(url: URL, options: { requestInit?: RequestInit; fetch?: FetchLike }) {
		builtHttpTransports.push({ url, options });
	}

	async close(): Promise<void> {}
}

class FakeMcpClient {
	async connect(): Promise<void> {}
	async close(): Promise<void> {}

	async listTools() {
		return { tools: [{ name: 'http_tool', description: 'a tool', inputSchema: { type: 'object' } }] };
	}

	async callTool() {
		return { ok: true };
	}
}

/** Stand in for the MCP SDK client modules, so HTTP servers never reach the network. */
export const mcpSdkClientMock = { Client: FakeMcpClient };
export const mcpSdkStreamableHttpMock = { StreamableHTTPClientTransport: FakeHttpTransport };
export const mcpSdkSseMock = { SSEClientTransport: FakeHttpTransport };

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
