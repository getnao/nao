import { randomUUID } from 'node:crypto';

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
	_meta?: Record<string, unknown>;
};

export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;
export type ToolHandler<T> = (args: T, extra: ToolExtra) => Promise<ToolResult>;
export type LoggedToolHandler<T> = (args: T, extra: ToolExtra, callLogId: string) => Promise<ToolResult>;

export const TOOL_MODE_MAP: Record<string, (keyof McpEndpointSettings)[]> = {
	ask_nao: ['subAgentModeEnabled'],
	get_nao_answer: ['subAgentModeEnabled'],
	execute_sql: ['contextLayerModeEnabled'],
	grep: ['contextLayerModeEnabled'],
	ls: ['contextLayerModeEnabled'],
	create_story: ['contextLayerModeEnabled'],
	update_story: ['contextLayerModeEnabled'],
	display_chart: ['subAgentModeEnabled', 'contextLayerModeEnabled'],
	list_stories: ['subAgentModeEnabled', 'contextLayerModeEnabled'],
	get_story: ['subAgentModeEnabled', 'contextLayerModeEnabled'],
	archive_story: ['subAgentModeEnabled', 'contextLayerModeEnabled'],
	delete_story: ['subAgentModeEnabled', 'contextLayerModeEnabled'],
};

export function withLogging<T>(toolName: string, ctx: McpContext, handler: LoggedToolHandler<T>): ToolHandler<T> {
	return async (args: T, extra: ToolExtra) => {
		const modeKeys = TOOL_MODE_MAP[toolName];
		if (modeKeys && !modeKeys.some((key) => ctx.settings[key])) {
			return {
				content: [{ type: 'text' as const, text: 'This MCP mode is disabled by your admin.' }],
				isError: true,
			};
		}

		const callLogId = randomUUID();
		const start = Date.now();
		let success = true;
		let result: ToolResult | undefined;
		let thrownError: unknown;
		try {
			result = await handler(args, extra, callLogId);
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
				id: callLogId,
				projectId: ctx.projectId,
				userId: ctx.userId,
				toolName,
				durationMs: Date.now() - start,
				success,
				toolInput: args as unknown,
				toolOutput: thrownError !== undefined ? formatThrownError(thrownError) : extractLoggableOutput(result),
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
