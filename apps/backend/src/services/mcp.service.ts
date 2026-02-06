import type { Tool } from '@ai-sdk/provider-utils';
import { debounce } from '@nao/shared/utils';
import { EventEmitter } from 'events';
import { watch } from 'fs';
import { readFile } from 'fs/promises';

import { McpClient } from '../mcp/mcp.client';
import type { McpClientConfig, McpClientState } from '../types/mcp';

export class McpService extends EventEmitter {
	private static instance: McpService | null = null;

	private _mcpJsonFilePath: string;
	private _mcpClient: McpClient;
	private _mcpServers: { mcpServers: Record<string, McpClientConfig> };
	private _fileWatcher: ReturnType<typeof watch> | null = null;
	private _cachedToolsToClient: Map<string, string> = new Map();
	private _debouncedReconnect: () => void;
	private _initialized = false;
	public cachedMcpState: Record<string, McpClientState> = {};
	public cachedTools: Record<string, Tool> = {};

	private constructor() {
		super();
		this._mcpJsonFilePath = process.env.MCP_JSON_FILE_PATH || '';
		this._mcpServers = { mcpServers: {} };
		this._mcpClient = new McpClient();

		this._debouncedReconnect = debounce(async () => {
			await this.handleCacheMcpServerState();
		}, 2000);
		this._setupFileWatcher();

		this._mcpClient.startCleanupTimer();
	}

	public static getInstance(): McpService {
		if (!McpService.instance) {
			McpService.instance = new McpService();
		}
		return McpService.instance;
	}

	public async initializeMcpServerState(): Promise<void> {
		if (this._initialized) {
			return;
		}

		await this.handleCacheMcpServerState();
		this._initialized = true;
	}

	public async handleCacheMcpServerState(): Promise<void> {
		try {
			await this._mcpClient.closeAllPooledServers();

			await this._loadMcpServerFromFile();

			const failedConnections = await this._mcpClient.connectAllClients(this._mcpServers.mcpServers);

			const { mcpTools, toolsToClient } = await this._mcpClient.listTools();
			this._cachedToolsToClient = new Map(toolsToClient);

			this._cacheTools(mcpTools);

			await this._cacheMcpServerState(mcpTools, toolsToClient, failedConnections);

			await this._mcpClient.closeConnections();
		} catch (error) {
			console.error('[mcp] Failed to cache MCP state:', error);
			throw error;
		}
	}

	private async _loadMcpServerFromFile(): Promise<void> {
		if (!this._mcpJsonFilePath) {
			this._mcpServers = { mcpServers: {} };
			return;
		}

		try {
			const fileContent = await readFile(this._mcpJsonFilePath, 'utf-8');
			this._mcpServers = JSON.parse(fileContent);
		} catch {
			this._mcpServers = { mcpServers: {} };
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private _cacheTools(mcpTools: Record<string, any>): void {
		this.cachedTools = Object.fromEntries(
			Object.entries(mcpTools).map(([toolName, tool]) => [
				toolName,
				{
					...tool,
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					execute: async (input: any) => {
						return await this._callTool(toolName, input);
					},
				},
			]),
		);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private async _callTool(toolName: string, toolArgs: any): Promise<any> {
		const clientName = this._cachedToolsToClient.get(toolName);
		if (!clientName) {
			throw new Error(`Tool ${toolName} not found in any server`);
		}

		const serverConfig = this._mcpServers.mcpServers[clientName];
		if (!serverConfig) {
			throw new Error(`Server config for ${clientName} not found`);
		}

		const client = await this._mcpClient.getOrCreateClient(clientName, serverConfig);

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

	private async _cacheMcpServerState(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mcpTools: Record<string, any>,
		toolsToServer: Map<string, string>,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		failedConnections: Record<string, any>,
	): Promise<void> {
		this.cachedMcpState = {};

		for (const serverName of Object.keys(this._mcpServers.mcpServers)) {
			const serverTools = Object.entries(mcpTools)
				.filter(([toolName]) => toolsToServer.get(toolName) === serverName)
				.map(([toolName, tool]) => ({
					name: toolName,
					description: tool.description,
					input_schema: tool.inputSchema,
				}));

			this.cachedMcpState[serverName] = {
				tools: serverTools,
				error: failedConnections[serverName],
			};
		}
	}

	private _setupFileWatcher(): void {
		if (!this._mcpJsonFilePath) {
			return;
		}

		try {
			this._fileWatcher = watch(this._mcpJsonFilePath, (eventType) => {
				if (eventType === 'change') {
					this._debouncedReconnect();
				}
			});
		} catch (error) {
			console.error('[mcp] Failed to setup file watcher:', error);
		}
	}
}

export const mcpService = McpService.getInstance();
