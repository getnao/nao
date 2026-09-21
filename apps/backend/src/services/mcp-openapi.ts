import type { McpTransport } from '@nao/shared';

import { sanitizeTools } from '../utils/tools';

export interface OpenApiToolInfo {
	name: string;
	description?: string;
}

export interface McpToolDefinition {
	name: string;
	description?: string;
	inputSchema: unknown;
}

export interface McpOpenApiDocument {
	openapi: '3.1.0';
	info: {
		title: string;
		version: string;
		description: string;
	};
	'x-mcp': {
		server: string;
		transport: McpTransport;
		toolCount: number;
	};
	paths: Record<string, unknown>;
}

/**
 * Builds an OpenAPI 3.1 document describing an MCP server's tools. Each tool becomes a
 * `POST /tools/{name}` operation whose request body is the tool's input schema. The agent
 * explores these specs on disk and invokes a tool via the `mcp_call` tool.
 */
export function buildMcpOpenApiDocument(opts: {
	serverName: string;
	transport: McpTransport;
	tools: McpToolDefinition[];
}): McpOpenApiDocument {
	const paths: Record<string, unknown> = {};

	for (const tool of opts.tools) {
		paths[`/tools/${tool.name}`] = {
			post: {
				operationId: tool.name,
				summary: tool.name,
				description: tool.description ?? '',
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: sanitizeTools(tool.inputSchema) ?? { type: 'object' },
						},
					},
				},
				responses: {
					'200': { description: 'Tool result' },
				},
			},
		};
	}

	return {
		openapi: '3.1.0',
		info: {
			title: `${opts.serverName} (MCP)`,
			version: '1.0.0',
			description:
				`OpenAPI specification for the "${opts.serverName}" MCP server. ` +
				`Invoke an operation with the mcp_call tool: ` +
				`mcp_call({ server: "${opts.serverName}", tool: "<operationId>", arguments: { ... } }).`,
		},
		'x-mcp': {
			server: opts.serverName,
			transport: opts.transport,
			toolCount: opts.tools.length,
		},
		paths,
	};
}

/** Extracts the tool summaries (name + description) from a generated MCP OpenAPI document. */
export function extractToolsFromOpenApi(doc: unknown): OpenApiToolInfo[] {
	if (!doc || typeof doc !== 'object') {
		return [];
	}
	const paths = (doc as { paths?: Record<string, unknown> }).paths;
	if (!paths || typeof paths !== 'object') {
		return [];
	}

	const tools: OpenApiToolInfo[] = [];
	for (const [path, operation] of Object.entries(paths)) {
		if (!path.startsWith('/tools/')) {
			continue;
		}
		const post = (operation as { post?: { operationId?: string; description?: string } })?.post;
		if (post?.operationId) {
			tools.push({ name: post.operationId, description: post.description || undefined });
		}
	}
	return tools;
}
