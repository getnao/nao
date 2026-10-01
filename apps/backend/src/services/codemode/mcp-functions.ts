import { McpArgsValidationError, mcpService } from '../mcp';
import { McpAuthRequiredError } from '../mcp-oauth';
import type { CodemodeFunction } from './sandbox';

export const MCP_NAMESPACE = 'mcp';

export interface McpFunctionsOptions {
	projectId: string;
	userId: string;
	/** Servers scripts may call; null for every enabled server. */
	allowedServers: string[] | null;
	/** Called when a call needs the user to connect their own account to the server first. */
	onAuthRequired: (server: string) => void;
}

type McpContentBlock = { type: string; text?: string };

interface McpCallToolResult {
	content: McpContentBlock[];
	structuredContent?: unknown;
	isError?: boolean;
}

/** One `mcp.<server>.<tool>` function per tool the run may call. */
export async function createMcpFunctions(options: McpFunctionsOptions): Promise<CodemodeFunction[]> {
	const servers = await mcpService.getCallableTools(options.projectId, options.allowedServers);
	return servers.flatMap(({ server, tools }) =>
		tools.map((tool) => ({
			path: [MCP_NAMESPACE, server, tool],
			execute: (args: unknown) => callMcpTool(options, server, tool, args),
		})),
	);
}

/**
 * What a script receives for an MCP result: its structured content when it has one, otherwise its
 * text parsed as JSON when possible, otherwise the text. Error results throw their text.
 */
export function toScriptValue(result: unknown): unknown {
	if (!isCallToolResult(result)) {
		return result;
	}
	const text = textOf(result.content);
	if (result.isError) {
		throw new Error(text || 'The MCP tool returned an error.');
	}
	if (result.structuredContent !== undefined) {
		return result.structuredContent;
	}
	return text ? parseJsonOrText(text) : result.content;
}

async function callMcpTool(options: McpFunctionsOptions, server: string, tool: string, args: unknown) {
	try {
		const result = await mcpService.callTool({
			projectId: options.projectId,
			userId: options.userId,
			server,
			tool,
			args: toArgumentsObject(args, server, tool),
			allowedServers: options.allowedServers,
		});
		return toScriptValue(result);
	} catch (error) {
		if (error instanceof McpAuthRequiredError) {
			options.onAuthRequired(error.server);
			throw new Error(
				`AUTH_REQUIRED: the user has not connected their account to the MCP server "${error.server}".`,
			);
		}
		if (error instanceof McpArgsValidationError) {
			throw new Error(
				`Invalid arguments for mcp.${server}.${tool}: ${error.issues.join('; ')}. Check /agent/mcps/${server}/${tool}.json.`,
			);
		}
		throw error;
	}
}

function toArgumentsObject(args: unknown, server: string, tool: string): Record<string, unknown> {
	if (args === undefined || args === null) {
		return {};
	}
	if (typeof args !== 'object' || Array.isArray(args)) {
		throw new TypeError(`mcp.${server}.${tool} takes one object argument matching its request body schema.`);
	}
	return args as Record<string, unknown>;
}

function isCallToolResult(value: unknown): value is McpCallToolResult {
	return !!value && typeof value === 'object' && Array.isArray((value as McpCallToolResult).content);
}

function textOf(content: McpContentBlock[]): string {
	return content
		.filter((block) => block.type === 'text' && typeof block.text === 'string')
		.map((block) => block.text)
		.join('\n');
}

function parseJsonOrText(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}
