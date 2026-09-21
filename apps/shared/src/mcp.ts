import { z } from 'zod/v4';

export interface McpServerConfig {
	type?: 'http';
	transport?: 'streamable-http' | 'sse' | 'http' | 'stdio';
	url?: URL;
	headers?: Record<string, string>;

	// For stdio transport
	command?: string;
	args?: string[];
	env?: Record<string, string>;
}

export type McpTransport = 'http' | 'stdio';

export interface McpToolSummary {
	name: string;
	description?: string;
	/** Whether the agent is allowed to use this tool (server enabled and tool not disabled). */
	enabled: boolean;
}

/**
 * Status of a single MCP server configured in `agent/mcps/mcp.json`. Tools are no
 * longer loaded into the agent context window — each enabled tool is discovered into a
 * per-tool OpenAPI spec on disk and invoked on demand via the `mcp_call` tool.
 */
export interface McpServerStatus {
	name: string;
	transport: McpTransport;
	/** Origin of the server URL for HTTP servers (used to display the server favicon). */
	url?: string;
	/** Whether the server is enabled (a disabled server turns all its tools off). */
	enabled: boolean;
	/** Whether tool specs exist on disk (or tools were discovered this session). */
	discovered: boolean;
	/** Whether the last connection attempt succeeded. */
	connectionOk: boolean;
	/** Whether the server requires per-user OAuth (admin connects for discovery, users connect to call). */
	oauth: boolean;
	/** Whether the requesting user has connected their account for this OAuth server. */
	oauthConnected: boolean;
	toolCount: number;
	enabledToolCount: number;
	tools: McpToolSummary[];
	/** Virtual path (project-relative) of the server's generated specs folder. */
	specPath: string;
	/** Last connection error for this server, if any. */
	error?: string;
}

export const mcpJsonSchema = z.object({
	mcpServers: z.record(
		z.string(),
		z.object({
			type: z.enum(['http']).optional(),
			transport: z.enum(['streamable-http', 'sse', 'http', 'stdio']).optional(),
			url: z
				.string()
				.url()
				.optional()
				.transform((val) => (val ? new URL(val) : undefined)),
			headers: z.record(z.string(), z.string()).optional(),
			command: z.string().optional(),
			args: z.array(z.string()).optional(),
			env: z.record(z.string(), z.string()).optional(),
		}),
	),
});
