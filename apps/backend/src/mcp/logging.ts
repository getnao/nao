import { randomUUID } from 'node:crypto';

import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';

import { insertMcpCallLog } from '../queries/mcp-endpoint.queries';
import { posthog, PostHogEvent } from '../services/posthog';
import type { McpEndpointSettings, McpUserRole } from '../types/mcp-endpoint';
import { truncateMiddle } from '../utils/utils';

export interface McpContext {
	userId: string;
	projectId: string;
	testAttemptId: string | null;
	role: McpUserRole;
	settings: McpEndpointSettings;
	/** When true, chart tools return config + data rows for the client agent to render itself instead of embed links/apps only. */
	chartDataMode: boolean;
	storyCreationEnabled: boolean;
	customStoryCreationEnabled: boolean;
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
	execute_semantic_query: ['contextLayerModeEnabled'],
	grep_nao_context: ['contextLayerModeEnabled'],
	ls_nao_context: ['contextLayerModeEnabled'],
	read_nao_context: ['contextLayerModeEnabled'],
	create_story: ['contextLayerModeEnabled'],
	update_story: ['contextLayerModeEnabled'],
	display_chart: ['subAgentModeEnabled', 'contextLayerModeEnabled'],
	display_map: ['subAgentModeEnabled', 'contextLayerModeEnabled'],
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
			trackToolCall(toolName, ctx, Date.now() - start, success);
			const saveCall = insertMcpCallLog({
				id: callLogId,
				projectId: ctx.projectId,
				userId: ctx.userId,
				testAttemptId: ctx.testAttemptId,
				toolName,
				durationMs: Date.now() - start,
				success,
				toolInput: args as unknown,
				toolOutput: thrownError !== undefined ? formatThrownError(thrownError) : extractLoggableOutput(result),
			});
			if (ctx.testAttemptId) {
				await saveCall;
			} else {
				saveCall.catch(() => {});
			}
		}
	};
}

const MODE_TRACKING_NAMES: Partial<Record<keyof McpEndpointSettings, string>> = {
	subAgentModeEnabled: 'sub_agent',
	contextLayerModeEnabled: 'context_layer',
};

function trackToolCall(toolName: string, ctx: McpContext, durationMs: number, success: boolean): void {
	posthog.capture(ctx.userId, PostHogEvent.McpToolCalled, {
		project_id: ctx.projectId,
		tool_name: toolName,
		tool_modes: getToolModes(toolName),
		success,
		duration_ms: durationMs,
		user_role: ctx.role,
		sub_agent_mode_enabled: ctx.settings.subAgentModeEnabled,
		context_layer_mode_enabled: ctx.settings.contextLayerModeEnabled,
		chart_data_mode: ctx.chartDataMode,
	});
}

/** The MCP modes a tool belongs to; empty for tools available regardless of the mode. */
function getToolModes(toolName: string): string[] {
	const modeKeys = TOOL_MODE_MAP[toolName] ?? [];
	return modeKeys.flatMap((key) => MODE_TRACKING_NAMES[key] ?? []);
}

const MAX_LOGGED_OUTPUT_CHARS = 10_000;

function extractLoggableOutput(result: ToolResult | undefined): unknown {
	if (!result) {
		return undefined;
	}
	const text = result.content
		.filter((part): part is { type: 'text'; text: string } => part.type === 'text')
		.map((part) => part.text)
		.join('\n');
	if (text.length <= MAX_LOGGED_OUTPUT_CHARS && (text.startsWith('{') || text.startsWith('['))) {
		const parsed = tryParseJson(text);
		if (parsed !== undefined) {
			return parsed;
		}
	}
	return truncateMiddle(text, MAX_LOGGED_OUTPUT_CHARS, ' … [truncated] … ');
}

function tryParseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function formatThrownError(error: unknown): { error: string } {
	if (error instanceof Error) {
		return { error: error.message };
	}
	return { error: String(error) };
}
