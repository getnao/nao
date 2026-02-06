import type { MCPClient } from '@ai-sdk/mcp';

export interface McpClientConfig {
	name: string;

	type?: 'http' | 'sse';
	url?: string;

	// For stdio transport
	command?: string;
	args?: string[];
	env?: Record<string, string>;
}

export interface CachedMcpClient {
	client: MCPClient;
	createdAt: number;
	lastUsedAt: number;
}

export interface McpClientState {
	tools: Array<{
		name: string;
		description?: string;
		input_schema: unknown;
	}>;
	error?: string;
}
