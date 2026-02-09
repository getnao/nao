import type { Tool } from '@ai-sdk/provider-utils';
import { debounce } from '@nao/shared/utils';
import { readFileSync, watch } from 'fs';

import { McpClient } from '../mcp/mcp.client';
import type { McpServerConfig, McpServerState } from '../types/mcp';
import { replaceEnvVars } from '../utils/utils';

export class McpService {
	private static instance: McpService | null = null;

	private _mcpJsonFilePath: string;
	private _mcpClient: McpClient;
	private _mcpServers: { mcpServers: Record<string, McpServerConfig> };
	private _fileWatcher: ReturnType<typeof watch> | null = null;
	private _debouncedReconnect: () => void;
	private _initialized = false;
	public cachedMcpState: Record<string, McpServerState> = {};
	public cachedTools: Record<string, Tool> = {};

	private constructor() {
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
			await this._mcpClient.closeAllRunningServers();

			await this._loadMcpServerFromFile();

			const failedConnections = await this._mcpClient.connectAllServers(this._mcpServers.mcpServers);

			const { mcpTools, toolsToServer } = await this._mcpClient.listTools();

			this._cacheTools(mcpTools);

			await this._cacheMcpServerState(toolsToServer, failedConnections);

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
			const fileContent = readFileSync(this._mcpJsonFilePath, 'utf8');
			const resolvedConfig = replaceEnvVars(fileContent);
			this._mcpServers = resolvedConfig;
		} catch {
			this._mcpServers = { mcpServers: {} };
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private _cacheTools(mcpTools: Record<string, any>): void {
		this.cachedTools = Object.fromEntries(
			Object.entries(mcpTools).map(([toolName, tool]) => {
				return [
					toolName,
					{
						...tool,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						execute: async (toolArgs: any) => {
							return await this._mcpClient.callTool(toolName, toolArgs);
						},
					},
				];
			}),
		);
	}

	private async _cacheMcpServerState(
		toolsToServer: Map<string, string>,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		failedConnections: Record<string, any>,
	): Promise<void> {
		this.cachedMcpState = {};

		for (const serverName of Object.keys(this._mcpServers.mcpServers)) {
			const serverTools = Object.entries(this.cachedTools)
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
