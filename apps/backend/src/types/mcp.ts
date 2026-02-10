import type { MCPClient } from '@ai-sdk/mcp';

export interface McpServerConfig {
	name: string;

	type?: 'http';
	url?: URL;

	// For stdio transport
	command?: string;
	args?: string[];
	env?: Record<string, string>;
}

export interface RunningMcpClient {
	client: MCPClient;
	serverId: string;
	serverConfig: McpServerConfig;
	createdAt: number;
	lastUsedAt: number;
}

export interface McpServerState {
	tools: Array<{
		name: string;
		description?: string;
		input_schema: unknown;
	}>;
	error?: string;
}
