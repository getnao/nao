import type { Tool, ToolExecutionOptions } from 'ai';

import { buildToolContext } from '../../services/agent';
import type { ToolContext } from '../../types/tools';
import type { McpContext } from '../logging';

export async function runAgentTool<I, O>(tool: Tool<I, O>, input: I, ctx: McpContext): Promise<O> {
	if (!tool.execute) {
		throw new Error(`Agent tool has no execute function`);
	}
	const chatId = ctx.sessionChatRef.lastChatId ?? '';
	const toolContext = await buildToolContext({ projectId: ctx.projectId, userId: ctx.userId, chatId });
	return tool.execute(input, makeExecutionOptions(toolContext)) as Promise<O>;
}

function makeExecutionOptions(toolContext: ToolContext): ToolExecutionOptions & { experimental_context: ToolContext } {
	return { toolCallId: '', messages: [], experimental_context: toolContext };
}
