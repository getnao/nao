import type { Tool, ToolExecutionOptions } from 'ai';

import { buildMcpToolContext, buildToolContext } from '../../services/agent';
import type { McpToolContext, ToolContext } from '../../types/tools';
import type { McpContext } from '../logging';
import { resolveChartChatId } from './helpers';

/**
 * The chat id comes from the MCP client, so the tool only runs inside that chat when it is the
 * caller's own chat in this project. Any other id runs the tool outside a chat.
 */
export async function runAgentTool<I, O>(
	tool: Tool<I, O>,
	input: I,
	ctx: McpContext,
	requestedChatId?: string | null,
): Promise<O> {
	if (!tool.execute) {
		throw new Error(`Agent tool has no execute function`);
	}
	const chatId = await resolveChartChatId(requestedChatId ?? undefined, ctx);
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
