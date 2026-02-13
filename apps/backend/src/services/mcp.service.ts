import type { Tool } from '@ai-sdk/provider-utils';
import { debounce } from '@nao/shared/utils';
import { jsonSchema, type JSONSchema7 } from 'ai';
import { readFileSync, watch } from 'fs';
import { createRuntime, type Runtime, ServerDefinition, ServerToolInfo } from 'mcporter';

import { env } from '../env';
import { mcpJsonSchema, McpServerConfig, McpServerState } from '../types/mcp';
import { prefixToolName, removePrefixToolName, sanitizeTools } from '../utils/tools';
import { replaceEnvVars } from '../utils/utils';

export class McpService {
	private _mcpJsonFilePath: string;
	private _mcpServers: Record<string, McpServerConfig>;
	private _fileWatcher: ReturnType<typeof watch> | null = null;
	private _debouncedReconnect: () => void;
	private _initialized = false;
	private _mcpTools: Record<string, Tool> = {};
	private _runtime: Runtime | null = null;
	private _failedConnections: Record<string, string> = {};
	private _toolsToServer: Map<string, string> = new Map();
	public cachedMcpState: Record<string, McpServerState> = {};

	constructor() {
		this._mcpJsonFilePath = env.MCP_JSON_FILE_PATH || '';
		this._mcpServers = {};

		this._debouncedReconnect = debounce(async () => {
			await this.loadMcpState();
		}, 2000);
		this._setupFileWatcher();
	}

	public async initializeMcpState(): Promise<void> {
		if (this._initialized) {
			return;
		}

		await this.loadMcpState();
		this._initialized = true;
	}

	public async loadMcpState(): Promise<void> {
		try {
			await this._loadMcpServerFromFile();

			await this._connectAllServers();

			await this._cacheMcpState();
		} catch (error) {
			console.error('[mcp] Failed to cache MCP state:', error);
			throw error;
		}
	}

	public getMcpTools(): Record<string, Tool> {
		const sanitizedMcpTools = Object.fromEntries(
			Object.entries(this._mcpTools).map(([name, tool]) => {
				const inputSchema = tool.inputSchema;

				// If it's an AI SDK schema wrapper with jsonSchema getter
				if (inputSchema && typeof inputSchema === 'object' && 'jsonSchema' in inputSchema) {
					const originalJsonSchema = inputSchema.jsonSchema;
					return [
						name,
						{
							...tool,
							inputSchema: {
								...inputSchema,
								jsonSchema: sanitizeTools(originalJsonSchema),
							},
						} as Tool,
					];
				}

				// Otherwise, sanitize the schema directly
				return [
					name,
					{
						...tool,
						inputSchema: sanitizeTools(inputSchema),
					} as Tool,
				];
			}),
		);
		return sanitizedMcpTools;
	}

	private async _loadMcpServerFromFile(): Promise<void> {
		if (!this._mcpJsonFilePath) {
			this._mcpServers = {};
			return;
		}

		try {
			const fileContent = readFileSync(this._mcpJsonFilePath, 'utf8');
			const resolvedContent = replaceEnvVars(fileContent);
			const content = mcpJsonSchema.parse(JSON.parse(resolvedContent));
			this._mcpServers = content.mcpServers;
		} catch {
			console.error(
				`[mcp] Failed to read or parse MCP config file at ${this._mcpJsonFilePath}. Using empty configuration.`,
			);
			this._mcpServers = {};
		}
	}

	private async _connectAllServers(): Promise<void> {
		this._mcpTools = {};
		this._runtime = await createRuntime();

		const connectionPromises = Object.entries(this._mcpServers).map(async ([serverName, serverConfig]) => {
			try {
				if (!this._runtime) {
					throw new Error('Runtime not initialized');
				}
				const definition = this._convertToServerDefinition(serverName, serverConfig);
				this._runtime.registerDefinition(definition, { overwrite: true });
				await this._listTools(serverName);
				return { serverName, success: true };
			} catch (error) {
				console.error(`[mcp] Failed to connect to ${serverName}:`, error);
				this._failedConnections[serverName] = (error as Error).message;
			}
		});

		await Promise.all(connectionPromises);
	}

	// Convert MCP server config to MCPorter server definition
	private _convertToServerDefinition(name: string, config: McpServerConfig): ServerDefinition {
		if (config.type === 'http') {
			return {
				name,
				command: {
					kind: 'http',
					url: config.url!,
				},
			};
		}

		return {
			name,
			command: {
				kind: 'stdio',
				command: config.command || '',
				args: config.args || [],
				cwd: process.cwd(),
			},
			env: config.env,
		};
	}

	private async _listTools(serverName: string): Promise<void> {
		if (!this._runtime) {
			throw new Error('Runtime not initialized');
		}

		const tools = await this._runtime.listTools(serverName, {
			includeSchema: true,
		});

		await this.cacheMcpTools(tools, serverName);
	}

	private async cacheMcpTools(tools: ServerToolInfo[], serverName: string): Promise<void> {
		for (const tool of tools) {
			const toolName = tool.name.startsWith(serverName) ? tool.name : prefixToolName(serverName, tool.name);
			this._mcpTools[toolName] = {
				description: tool.description,
				inputSchema: jsonSchema(tool.inputSchema as JSONSchema7),
				execute: async (toolArgs: Record<string, unknown>) => {
					return await this._callTool(toolName, toolArgs);
				},
			};
			this._toolsToServer.set(toolName, serverName);
		}
	}

	private async _callTool(toolName: string, toolArgs: Record<string, unknown>): Promise<unknown> {
		const serverName = this._toolsToServer.get(toolName);
		if (!serverName) {
			throw new Error(`Tool ${toolName} not found in any server`);
		}

		if (!this._runtime) {
			throw new Error('Runtime not initialized');
		}

		const result = await this._runtime.callTool(serverName, removePrefixToolName(toolName), {
			args: toolArgs,
		});

		return result;
	}

	private async _cacheMcpState(): Promise<void> {
		this.cachedMcpState = {};

		for (const serverName of Object.keys(this._mcpServers)) {
			const serverTools = Object.entries(this._mcpTools)
				.filter(([toolName]) => this._toolsToServer.get(toolName) === serverName)
				.map(([toolName, tool]) => ({
					name: toolName,
					description: tool.description,
					input_schema: tool.inputSchema,
				}));

			this.cachedMcpState[serverName] = {
				tools: serverTools,
				error: this._failedConnections[serverName],
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

export const mcpService = new McpService();
