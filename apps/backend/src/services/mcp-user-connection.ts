import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpOAuthConfig } from '@nao/shared';

import { mcpOAuthRedirectUri } from './mcp-oauth.service';
import { McpOAuthProvider } from './mcp-oauth-provider';

export interface McpOAuthServer {
	url: URL;
	oauth: McpOAuthConfig;
}

export interface McpConnectionTarget {
	userId: string;
	projectId: string;
	serverName: string;
	server: McpOAuthServer;
}

export interface ListedMcpTool {
	name: string;
	description?: string;
	inputSchema: unknown;
}

/**
 * Manages per-user MCP client connections to OAuth-protected remote servers, keyed by
 * `(userId, serverName)`. Each connection authenticates with the calling user's own tokens
 * via a {@link McpOAuthProvider}, so tool execution runs under that user's credentials.
 * Connections are cached and reused (the SDK transport refreshes tokens on demand); an
 * unauthorized connection (the user has not completed the OAuth flow) yields no tools.
 */
export class McpUserConnections {
	private readonly clients = new Map<string, Client>();

	/** Lists a server's tools for a user, or returns `null` when the user is not yet authorized. */
	async listTools(target: McpConnectionTarget): Promise<ListedMcpTool[] | null> {
		const client = await this.connect(target);
		if (!client) {
			return null;
		}

		const { tools } = await client.listTools();
		return tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }));
	}

	/** Executes a tool through the user's connection, reconnecting once if the cached client is gone. */
	async callTool(target: McpConnectionTarget, toolName: string, args: Record<string, unknown>): Promise<unknown> {
		const client = (await this.connect(target)) ?? null;
		if (!client) {
			throw new UnauthorizedError(`Not connected to MCP server '${target.serverName}'`);
		}

		try {
			return await client.callTool({ name: toolName, arguments: args });
		} catch (error) {
			if (error instanceof UnauthorizedError) {
				await this.disconnect(target.userId, target.serverName);
			}
			throw error;
		}
	}

	async disconnect(userId: string, serverName?: string): Promise<void> {
		const prefix = serverName ? connectionKey(userId, serverName) : `${userId}::`;
		for (const [key, client] of this.clients) {
			if (key === prefix || (!serverName && key.startsWith(prefix))) {
				this.clients.delete(key);
				await client.close().catch(() => undefined);
			}
		}
	}

	async closeAll(): Promise<void> {
		const clients = [...this.clients.values()];
		this.clients.clear();
		await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
	}

	private async connect(target: McpConnectionTarget): Promise<Client | null> {
		const key = connectionKey(target.userId, target.serverName);
		const cached = this.clients.get(key);
		if (cached) {
			return cached;
		}

		const provider = new McpOAuthProvider({
			session: { userId: target.userId, projectId: target.projectId, serverName: target.serverName },
			config: target.server.oauth,
			redirectUri: mcpOAuthRedirectUri(),
		});
		const transport = new StreamableHTTPClientTransport(target.server.url, { authProvider: provider });
		const client = new Client({ name: 'nao', version: '1.0.0' });

		try {
			await client.connect(transport);
		} catch (error) {
			if (error instanceof UnauthorizedError) {
				return null;
			}
			throw error;
		}

		this.clients.set(key, client);
		return client;
	}
}

function connectionKey(userId: string, serverName: string): string {
	return `${userId}::${serverName}`;
}
