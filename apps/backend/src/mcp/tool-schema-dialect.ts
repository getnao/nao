import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

type JsonSchema = Record<string, unknown>;

interface ListedTool {
	inputSchema?: JsonSchema;
	outputSchema?: JsonSchema;
}

/**
 * The MCP SDK stamps every Zod-derived tool schema with `$schema: draft-07`, which
 * recent clients (Claude Desktop, Claude Code) reject because their validators only
 * accept JSON Schema 2020-12. Without a `$schema`, the spec defaults to 2020-12 and
 * every client accepts the schema, so we drop it from `tools/list` responses.
 */
export function withoutJsonSchemaDialect<T extends Transport>(transport: T): T {
	const send = transport.send.bind(transport);
	transport.send = (message, options) => {
		return send(stripToolSchemaDialects(message), options);
	};
	return transport;
}

export function stripToolSchemaDialects(message: JSONRPCMessage): JSONRPCMessage {
	if (!('result' in message) || !Array.isArray(message.result.tools)) {
		return message;
	}
	const tools = (message.result.tools as ListedTool[]).map(stripToolDialect);
	return { ...message, result: { ...message.result, tools } };
}

function stripToolDialect(tool: ListedTool): ListedTool {
	const stripped: ListedTool = { ...tool };
	if (tool.inputSchema) {
		stripped.inputSchema = withoutDialect(tool.inputSchema);
	}
	if (tool.outputSchema) {
		stripped.outputSchema = withoutDialect(tool.outputSchema);
	}
	return stripped;
}

function withoutDialect(schema: JsonSchema): JsonSchema {
	const { $schema: _dialect, ...rest } = schema;
	return rest;
}
