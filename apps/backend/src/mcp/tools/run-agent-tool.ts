import type { Tool, ToolExecutionOptions } from 'ai';

import { buildMcpToolContext, buildToolContext } from '../../services/agent';
import type { McpToolContext, ToolContext } from '../../types/tools';
import type { McpContext } from '../logging';

export async function runAgentTool<I, O>(
	tool: Tool<I, O>,
	input: I,
	ctx: McpContext,
	chatId?: string | null,
): Promise<O> {
	if (!tool.execute) {
		throw new Error(`Agent tool has no execute function`);
	}
	if (ctx.testAttemptId && hasSaveDestination(input)) {
		throw new Error('save_to is unavailable during test attempts. Run the query without save_to.');
	}
	const toolContext = chatId
		? await buildToolContext({ projectId: ctx.projectId, userId: ctx.userId, chatId })
		: await buildMcpToolContext({ projectId: ctx.projectId, userId: ctx.userId });
	if (ctx.testAttemptId) {
		toolContext.agentSettings = {
			...toolContext.agentSettings,
			sql: { ...toolContext.agentSettings?.sql, dangerouslyWritePermEnabled: false },
		};
	}
	return tool.execute(input, makeExecutionOptions(toolContext)) as Promise<O>;
}

function hasSaveDestination(input: unknown): boolean {
	return typeof input === 'object' && input !== null && 'save_to' in input && input.save_to !== undefined;
}

function makeExecutionOptions(
	toolContext: ToolContext | McpToolContext,
): ToolExecutionOptions & { experimental_context: ToolContext | McpToolContext } {
	return { toolCallId: '', messages: [], experimental_context: toolContext };
}
