import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import type { McpServerConfig, RunningMcpClient } from '../types/mcp';

export class McpClient {
	private _runningServers: Map<string, RunningMcpClient> = new Map();
	private _ttlMs: number = 5 * 60 * 1000; // 5 minutes
	private _cleanupInterval: NodeJS.Timeout | null = null;
	private _clients: Map<string, MCPClient> = new Map();
	private _toolsToServer: Map<string, string> = new Map();
	private _serverConfigs: Map<string, McpServerConfig> = new Map();

	public async connectAllServers(mcpServers: Record<string, McpServerConfig>): Promise<Record<string, string>> {
		const failedConnections: Record<string, string> = {};

		for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
			this._serverConfigs.set(serverName, serverConfig);

			try {
				const client = await this._connectServer(serverConfig);
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
		toolsToServer: Map<string, string>;
	}> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const mcpTools: Record<string, any> = {};

		for (const [serverName, client] of this._clients) {
			try {
				const tools = await client.tools();

				for (const [toolName, tool] of Object.entries(tools)) {
					mcpTools[toolName] = tool;
					this._toolsToServer.set(toolName, serverName);
				}
			} catch (error) {
				console.error(`[mcp] Failed to list tools for ${serverName}:`, error);
			}
		}

		return { mcpTools, toolsToServer: this._toolsToServer };
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public async callTool(toolName: string, toolArgs: any): Promise<any> {
		const serverName = this._toolsToServer.get(toolName);
		if (!serverName) {
			throw new Error(`Tool ${toolName} not found in any server`);
		}

		const serverConfig = this._serverConfigs.get(serverName);
		if (!serverConfig) {
			throw new Error(`MCP server config for ${serverName} not found`);
		}

		const client = await this._getOrCreateServer(serverName, serverConfig);

		const tools = await client.tools({});
		const tool = tools[toolName];

		if (!tool || !tool.execute) {
			throw new Error(`Tool ${toolName} not found or not executable`);
		}

		return await tool.execute(toolArgs, {
			toolCallId: toolName,
			messages: [],
		});
	}

	public async closeAllRunningServers(): Promise<void> {
		for (const [serverName, runningServer] of this._runningServers) {
			try {
				await runningServer.client.close();
			} catch (error) {
				console.error(`[mcp] Error closing running server for ${serverName}:`, error);
			}
		}
		this._runningServers.clear();
		this._serverConfigs.clear();
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

	public startCleanupTimer(): void {
		if (this._cleanupInterval) return;

		this._cleanupInterval = setInterval(() => {
			this._disposeExpiredClients();
		}, 30000);
	}

	public stopCleanupTimer(): void {
		if (this._cleanupInterval) {
			clearInterval(this._cleanupInterval);
			this._cleanupInterval = null;
		}
	}

	private async _connectServer(serverConfig: McpServerConfig): Promise<MCPClient> {
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

	private async _getOrCreateServer(serverName: string, serverConfig: McpServerConfig): Promise<MCPClient> {
		const existing = this._runningServers.get(serverName);

		if (existing) {
			existing.lastUsedAt = Date.now();
			return existing.client;
		}

		const client = await this._connectServer(serverConfig);
		const now = Date.now();

		this._runningServers.set(serverName, {
			client,
			serverId: serverName,
			serverConfig,
			createdAt: now,
			lastUsedAt: now,
		});

		return client;
	}

	private async _disposeExpiredClients(): Promise<void> {
		const now = Date.now();

		for (const [serverName, cached] of this._runningServers) {
			const age = now - cached.lastUsedAt;

			if (age > this._ttlMs) {
				try {
					await cached.client.close();
				} catch (error) {
					console.error(`[mcp] Error closing expired client for ${serverName}:`, error);
				}
				this._runningServers.delete(serverName);
			}
		}
	}
}
