import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { McpContext, ToolResult } from '../../src/mcp/logging';

type ToolConfig = { description?: string; inputSchema?: Record<string, unknown> };
type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<ToolResult>;

/** Records what the nao MCP tools register, without the protocol layer of a real `McpServer`. */
export class FakeMcpServer {
	readonly tools = new Map<string, ToolConfig>();
	readonly handlers = new Map<string, ToolHandler>();

	registerTool(name: string, config: ToolConfig, handler: ToolHandler): void {
		this.tools.set(name, config);
		this.handlers.set(name, handler);
	}

	asMcpServer(): McpServer {
		return this as unknown as McpServer;
	}

	call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
		return this.handlers.get(name)!(args, {});
	}
}

export function createMcpContext(overrides: Partial<McpContext> = {}): McpContext {
	return {
		userId: 'user-1',
		projectId: 'project-1',
		settings: { enabled: true, subAgentModeEnabled: true, contextLayerModeEnabled: true },
		chartDataMode: false,
		storyCreationEnabled: false,
		customStoryCreationEnabled: false,
		...overrides,
	};
}
