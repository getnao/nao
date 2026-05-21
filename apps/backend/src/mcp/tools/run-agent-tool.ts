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
	const toolContext = chatId
		? await buildToolContext({ projectId: ctx.projectId, userId: ctx.userId, chatId })
		: await buildMcpToolContext({ projectId: ctx.projectId, userId: ctx.userId });
	return tool.execute(input, makeExecutionOptions(toolContext)) as Promise<O>;
}

function makeExecutionOptions(
	toolContext: ToolContext | McpToolContext,
): ToolExecutionOptions & { experimental_context: ToolContext | McpToolContext } {
	return { toolCallId: '', messages: [], experimental_context: toolContext };
}
