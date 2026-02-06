import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import type { CachedMcpClient, McpClientConfig } from '../types/mcp';

export class McpClient {
	private _clientPool: Map<string, CachedMcpClient> = new Map();
	private _ttlMs: number = 5 * 60 * 1000; // 5 minutes
	private _cleanupInterval: NodeJS.Timeout | null = null;
	private _clients: Map<string, MCPClient> = new Map();

	public async connectAllClients(mcpServers: Record<string, McpClientConfig>): Promise<Record<string, string>> {
		const failedConnections: Record<string, string> = {};

		for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
			try {
				const client = await this._connectClient(serverConfig);
				this._clients.set(serverName, client);
			} catch (error) {
				console.error(`[mcp] Failed to connect to ${serverName}:`, error);
				failedConnections[serverName] = (error as Error).message;
			}
		}

		return failedConnections;
	}

	public async listTools(): Promise<{
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mcpTools: Record<string, any>;
		toolsToClient: Map<string, string>;
	}> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const mcpTools: Record<string, any> = {};
		const toolsToClient = new Map<string, string>();

		for (const [serverName, client] of this._clients) {
			try {
				const tools = await client.tools();

				for (const [toolName, tool] of Object.entries(tools)) {
					mcpTools[toolName] = tool;
					toolsToClient.set(toolName, serverName);
				}
			} catch (error) {
				console.error(`[mcp] Failed to list tools for ${serverName}:`, error);
			}
		}

		return { mcpTools, toolsToClient };
	}

	public async getOrCreateClient(serverName: string, serverConfig: McpClientConfig): Promise<MCPClient> {
		const existing = this._clientPool.get(serverName);

		if (existing) {
			existing.lastUsedAt = Date.now();
			return existing.client;
		}

		const client = await this._connectClient(serverConfig);
		const now = Date.now();

		this._clientPool.set(serverName, {
			client,
			createdAt: now,
			lastUsedAt: now,
		});

		return client;
	}

	public async closeAllPooledServers(): Promise<void> {
		for (const [serverName, cached] of this._clientPool) {
			try {
				await cached.client.close();
			} catch (error) {
				console.error(`[mcp] Error closing connection ${serverName}:`, error);
			}
		}
		this._clientPool.clear();
	}

	public async closeConnections(): Promise<void> {
		for (const [serverName, client] of this._clients) {
			try {
				await client.close();
			} catch (error) {
				console.error(`[mcp] Error closing connection ${serverName}:`, error);
			}
		}
	}

	/**
	 * Start background cleanup timer (runs every 30 seconds)
	 */
	public startCleanupTimer(): void {
		if (this._cleanupInterval) return;

		this._cleanupInterval = setInterval(() => {
			this._disposeExpiredClients();
		}, 30000);
	}

	/**
	 * Stop background cleanup timer
	 */
	public stopCleanupTimer(): void {
		if (this._cleanupInterval) {
			clearInterval(this._cleanupInterval);
			this._cleanupInterval = null;
		}
	}

	/**
	 * Dispose expired connections (TTL-based cleanup)
	 */
	private async _disposeExpiredClients(): Promise<void> {
		const now = Date.now();

		for (const [serverName, cached] of this._clientPool) {
			const age = now - cached.lastUsedAt;

			if (age > this._ttlMs) {
				try {
					await cached.client.close();
				} catch (error) {
					console.error(`[mcp] Error closing expired client ${serverName}:`, error);
				}
				this._clientPool.delete(serverName);
			}
		}
	}

	private async _connectClient(serverConfig: McpClientConfig): Promise<MCPClient> {
		if (serverConfig.type === 'http' || serverConfig.type === 'sse') {
			if (!serverConfig.url) {
				throw new Error('URL is required for HTTP/SSE transport');
			}

			return await createMCPClient({
				transport: {
					type: serverConfig.type,
					url: serverConfig.url,
				},
			});
		}

		if (serverConfig.command) {
			const envVars = Object.fromEntries(
				Object.entries(process.env).filter(([_, value]) => value !== undefined),
			) as Record<string, string>;

			const transport = new StdioClientTransport({
				command: serverConfig.command,
				args: serverConfig.args,
				env: {
					...envVars,
					...serverConfig.env,
				},
				stderr: 'ignore',
			});

			return await createMCPClient({ transport });
		}

		throw new Error('Invalid server configuration: must provide either url (for HTTP/SSE) or command (for stdio)');
	}
}
