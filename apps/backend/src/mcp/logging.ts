import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';

import { insertMcpCallLog } from '../queries/mcp-endpoint.queries';
import type { McpEndpointSettings } from '../types/mcp-endpoint';

export interface McpContext {
	userId: string;
	projectId: string;
	settings: McpEndpointSettings;
}

export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export type ToolResult = {
	content: ToolContent[];
	isError?: boolean;
	structuredContent?: Record<string, unknown>;
};

export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;
export type ToolHandler<T> = (args: T, extra: ToolExtra) => Promise<ToolResult>;

export const TOOL_MODE_MAP: Record<string, keyof McpEndpointSettings> = {
	ask_nao: 'agentModeEnabled',
	execute_sql: 'toolsModeEnabled',
	grep: 'toolsModeEnabled',
	ls: 'toolsModeEnabled',
	list_stories: 'objectsModeEnabled',
	get_story: 'objectsModeEnabled',
	create_story: 'objectsModeEnabled',
	update_story: 'objectsModeEnabled',
	archive_story: 'objectsModeEnabled',
	delete_story: 'objectsModeEnabled',
};

export function withLogging<T>(toolName: string, ctx: McpContext, handler: ToolHandler<T>): ToolHandler<T> {
	return async (args: T, extra: ToolExtra) => {
		const modeKey = TOOL_MODE_MAP[toolName];
		if (modeKey && !ctx.settings[modeKey]) {
			return {
				content: [{ type: 'text' as const, text: 'This MCP mode is disabled by your admin.' }],
				isError: true,
			};
		}

		const start = Date.now();
		let success = true;
		let result: ToolResult | undefined;
		let thrownError: unknown;
		try {
			result = await handler(args, extra);
			if (result?.isError) {
				success = false;
			}
			return result;
		} catch (error) {
			success = false;
			thrownError = error;
			throw error;
		} finally {
			insertMcpCallLog({
				projectId: ctx.projectId,
				userId: ctx.userId,
				toolName,
				durationMs: Date.now() - start,
				success,
				toolInput: args as unknown,
				toolOutput: thrownError ? formatThrownError(thrownError) : extractLoggableOutput(result),
			}).catch(() => {});
		}
	};
}

function extractLoggableOutput(result: ToolResult | undefined): unknown {
	if (!result) {
		return undefined;
	}
	const text = result.content
		.filter((part): part is { type: 'text'; text: string } => part.type === 'text')
		.map((part) => part.text)
		.join('\n');
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function formatThrownError(error: unknown): { error: string } {
	if (error instanceof Error) {
		return { error: error.message };
	}
	return { error: String(error) };
}
