import type { Tool } from '@ai-sdk/provider-utils';
import { jsonSchema, type JSONSchema7 } from 'ai';
import { callOnce, createRuntime, type Runtime, ServerDefinition } from 'mcporter';

import { McpServerConfig } from '../types/mcp';

export class McpClient {
	private _runtime: Runtime | null = null;
	private _toolsToServer: Map<string, string> = new Map();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private _mcpTools: Record<string, any> = {};

	public async connectAllServers(mcpServers: Record<string, McpServerConfig>): Promise<{
		mcpTools: Record<string, Tool>;
		toolsToServer: Map<string, string>;
		failedConnections: Record<string, string>;
	}> {
		const failedConnections: Record<string, string> = {};

		this._runtime = await createRuntime();

		for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
			try {
				const definition = this._convertToServerDefinition(serverName, serverConfig);
				this._runtime.registerDefinition(definition, { overwrite: true });
				await this.listTools(serverName);
			} catch (error) {
				console.error(`[mcp] Failed to connect to ${serverName}:`, error);
				failedConnections[serverName] = (error as Error).message;
			}
		}

		return { mcpTools: this._mcpTools, toolsToServer: this._toolsToServer, failedConnections };
	}

	public async listTools(serverName: string): Promise<void> {
		if (!this._runtime) {
			throw new Error('Runtime not initialized');
		}

		const tools = await this._runtime.listTools(serverName, {
			includeSchema: true,
		});

		for (const tool of tools) {
			this._mcpTools[tool.name] = {
				description: tool.description,
				inputSchema: jsonSchema(tool.inputSchema as JSONSchema7),
			};
			this._toolsToServer.set(tool.name, serverName);
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public async callTool(toolName: string, toolArgs: any): Promise<any> {
		const serverName = this._toolsToServer.get(toolName);
		if (!serverName) {
			throw new Error(`Tool ${toolName} not found in any server`);
		}

		const result = await callOnce({
			server: serverName,
			toolName: toolName,
			args: toolArgs,
		});

		return result;
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
}
