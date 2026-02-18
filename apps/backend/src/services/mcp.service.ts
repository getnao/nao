import type { Tool } from '@ai-sdk/provider-utils';
import { debounce } from '@nao/shared';
import { jsonSchema, type JSONSchema7 } from 'ai';
import { existsSync, readFileSync, watch } from 'fs';
import { createRuntime, type Runtime, ServerDefinition, ServerToolInfo } from 'mcporter';
import { join } from 'path';

import {
	isProjectMcpToolEnabled,
	resolveProjectMcpToolEnabledStates,
} from '../queries/project-mcp-tool-setting.queries';
import { mcpJsonSchema, McpServerConfig, McpServerState } from '../types/mcp';
import { retrieveProjectById } from '../utils/chat';
import { prefixToolName, removePrefixToolName, sanitizeTools } from '../utils/tools';
import { replaceEnvVars } from '../utils/utils';

export class McpService {
	private _mcpJsonFilePath: string;
	private _mcpServers: Record<string, McpServerConfig>;
	private _fileWatcher: ReturnType<typeof watch> | null = null;
	private _debouncedReconnect: () => void;
	private _initPromise: Promise<void> | null = null;
	private _mcpTools: Record<string, Tool> = {};
	private _runtime: Runtime | null = null;
	private _failedConnections: Record<string, string> = {};
	private _toolsToServer: Map<string, string> = new Map();
	private _projectId: string | null = null;
	public cachedMcpState: Record<string, McpServerState> = {};

	constructor() {
		this._mcpJsonFilePath = '';
		this._mcpServers = {};

		this._debouncedReconnect = debounce(async () => {
			await this.loadMcpState();
		}, 2000);
	}

	public async initializeMcpState(projectId: string): Promise<void> {
		if (this._projectId !== projectId) {
			if (this._fileWatcher) {
				this._fileWatcher.close();
				this._fileWatcher = null;
			}
			this._initPromise = null;
		}

		this._projectId = projectId;

		if (!this._initPromise) {
			this._initPromise = this._initialize(projectId).catch((err) => {
				this._initPromise = null;
				throw err;
			});
		}

		return this._initPromise;
	}

	private async _initialize(projectId: string): Promise<void> {
		const project = await retrieveProjectById(projectId);
		this._mcpJsonFilePath = join(project.path || '', 'agent', 'mcps', 'mcp.json');

		await this.loadMcpState();
		this._setupFileWatcher();
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

	public async getMcpTools(projectId: string): Promise<Record<string, Tool>> {
		if (!this._initPromise || this._projectId !== projectId) {
			await this.initializeMcpState(projectId);
		}

		const enabledToolNames = new Set(
			Object.values(this.cachedMcpState)
				.flatMap((server) => server.tools)
				.filter((tool) => tool.enabled)
				.map((tool) => tool.name),
		);

		const sanitizedMcpTools = Object.fromEntries(
			Object.entries(this._mcpTools)
				.filter(([name]) => enabledToolNames.has(name))
				.map(([name, tool]) => {
					const inputSchema = tool.inputSchema;

					if (inputSchema && typeof inputSchema === 'object' && 'jsonSchema' in inputSchema) {
						const originalJsonSchema = inputSchema.jsonSchema;
						return [
							name,
							{
								...tool,
								execute: async (toolArgs: Record<string, unknown>) => {
									return await this._callTool(name, toolArgs, projectId);
								},
								inputSchema: {
									...inputSchema,
									jsonSchema: sanitizeTools(originalJsonSchema),
								},
							} as Tool,
						];
					}

					return [
						name,
						{
							...tool,
							execute: async (toolArgs: Record<string, unknown>) => {
								return await this._callTool(name, toolArgs, projectId);
							},
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

		if (!existsSync(this._mcpJsonFilePath)) {
			this._mcpServers = {};
			return;
		}

		try {
			const fileContent = readFileSync(this._mcpJsonFilePath, 'utf8');
			const resolvedContent = replaceEnvVars(fileContent);
			const content = mcpJsonSchema.parse(JSON.parse(resolvedContent));
			this._mcpServers = content.mcpServers;
		} catch (error) {
			console.error(`[mcp] Failed to parse MCP config file at ${this._mcpJsonFilePath}:`, error);
			this._mcpServers = {};
		}
	}

	private async _connectAllServers(): Promise<void> {
		this._mcpTools = {};
		this._failedConnections = {};
		this._toolsToServer = new Map();
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
					if (!this._projectId) {
						throw new Error('MCP project context is not initialized');
					}
					return await this._callTool(toolName, toolArgs, this._projectId);
				},
			};
			this._toolsToServer.set(toolName, serverName);
		}
	}

	private async _callTool(toolName: string, toolArgs: Record<string, unknown>, projectId: string): Promise<unknown> {
		if (this._projectId !== projectId) {
			await this.initializeMcpState(projectId);
		}

		const serverName = this._toolsToServer.get(toolName);
		if (!serverName) {
			throw new Error(`Tool ${toolName} not found in any server`);
		}

		const enabled = await isProjectMcpToolEnabled({
			projectId,
			serverName,
			toolName,
		});
		if (!enabled) {
			throw new Error(`Tool ${toolName} is disabled by project admin`);
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
			const serverToolEntries = Object.entries(this._mcpTools).filter(
				([toolName]) => this._toolsToServer.get(toolName) === serverName,
			);
			const serverToolNames = serverToolEntries.map(([toolName]) => toolName);
			const enabledByTool =
				this._projectId && serverToolNames.length > 0
					? await resolveProjectMcpToolEnabledStates(this._projectId, serverName, serverToolNames)
					: Object.fromEntries(serverToolNames.map((toolName) => [toolName, true]));
			const serverTools = serverToolEntries.map(([toolName, tool]) => ({
				name: toolName,
				description: tool.description,
				input_schema: tool.inputSchema,
				enabled: enabledByTool[toolName] ?? false,
			}));

			this.cachedMcpState[serverName] = {
				tools: serverTools,
				error: this._failedConnections[serverName],
			};
		}
	}

	public async refreshToolAvailabilityForProject(projectId: string): Promise<void> {
		if (!this._initPromise || this._projectId !== projectId) {
			await this.initializeMcpState(projectId);
		}
		await this._cacheMcpState();
	}

	private _setupFileWatcher(): void {
		if (!this._mcpJsonFilePath) {
			return;
		}

		if (this._fileWatcher) {
			this._fileWatcher.close();
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
