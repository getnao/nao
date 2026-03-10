import { convertToModelMessages, type ModelMessage, type Tool } from 'ai';

import { KNOWN_MODELS } from '../agents/providers';
import { getTools } from '../agents/tools';
import { SystemPrompt } from '../components/ai';
import { renderToMarkdown } from '../lib/markdown';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import { compactionService } from '../services/compaction';
import { memoryService } from '../services/memory';
import { tokenCounter } from '../services/token-counter';
import type { ContextUsage, UIMessage } from '../types/chat';
import type { LlmProvider } from '../types/llm';

export async function getChatContextUsage(opts: {
	chatId: string;
	userId: string;
	model?: { provider: LlmProvider; modelId: string };
}): Promise<ContextUsage | null> {
	const projectId = await chatQueries.getChatProjectId(opts.chatId);
	if (!projectId) {
		return null;
	}
	const agentSettings = await projectQueries.getAgentSettings(projectId);
	const tools = getTools(agentSettings);
	const messages = await loadChatAsModelMessages({ ...opts, projectId, tools });
	const messageTokens = tokenCounter.estimateMessages(messages);
	const toolTokens = await tokenCounter.estimateTools(tools);
	return { tokensUsed: messageTokens + toolTokens, contextWindow: opts.model ? getContextWindow(opts.model) : null };
}

export async function loadChatAsModelMessages(opts: {
	chatId: string;
	userId: string;
	projectId: string;
	tools: Record<string, Tool>;
}): Promise<ModelMessage[]> {
	const uiMessages = await chatQueries.loadChatMessages(opts.chatId);
	const uiMessagesWithCompaction = compactionService.useLastCompaction(uiMessages);
	const memories = await memoryService.safeGetUserMemories(opts.userId, opts.projectId, opts.chatId);
	const systemPrompt = renderToMarkdown(SystemPrompt({ memories }));
	const systemMessage: Omit<UIMessage, 'id'> = {
		role: 'system',
		parts: [{ type: 'text', text: systemPrompt }],
	};
	return convertToModelMessages<UIMessage>([systemMessage, ...uiMessagesWithCompaction], { tools: opts.tools });
}

function getContextWindow({ provider, modelId }: { provider: LlmProvider; modelId: string }): number | null {
	const models = KNOWN_MODELS[provider] ?? [];
	const contextWindow = models.find((m) => m.id === modelId)?.contextWindow;
	return contextWindow ?? null;
}
