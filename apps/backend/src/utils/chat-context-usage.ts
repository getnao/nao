import type { LlmProvider } from '@nao/shared/types';
import { convertToModelMessages, isToolUIPart, type ModelMessage, type Tool } from 'ai';

import { KNOWN_MODELS } from '../agents/providers';
import { getTools } from '../agents/tools';
import { SystemPrompt } from '../components/ai';
import { renderToMarkdown } from '../lib/markdown';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import { compactionService } from '../services/compaction';
import { memoryService } from '../services/memory';
import { tokenCounter } from '../services/token-counter';
import type { ContextUsage, UIMessage, UIMessagePart } from '../types/chat';
import { maskPII, maskPIIValue } from './pii';

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
	const messages = await getChatAsModelMessages({ ...opts, projectId, tools });
	const messageTokens = tokenCounter.estimateMessages(messages);
	const toolTokens = await tokenCounter.estimateTools(tools);
	return { tokensUsed: messageTokens + toolTokens, contextWindow: opts.model ? getContextWindow(opts.model) : null };
}

export async function getChatAsModelMessages(opts: {
	chatId: string;
	userId: string;
	projectId: string;
	tools: Record<string, Tool>;
}): Promise<ModelMessage[]> {
	const uiMessages = await chatQueries.getChatMessages(opts.chatId);
	const uiMessagesWithCompaction = compactionService.useLastCompaction(uiMessages);
	const memories = await memoryService.safeGetUserMemories(opts.userId, opts.projectId, opts.chatId);
	const systemPrompt = renderToMarkdown(SystemPrompt({ memories }));
	const systemMessage: Omit<UIMessage, 'id'> = {
		role: 'system',
		parts: [{ type: 'text', text: maskPII(systemPrompt) }],
	};
	const maskedUiMessages = uiMessagesWithCompaction.map((message) => ({
		...message,
		parts: message.parts.map(maskContextMessagePart),
	}));
	return convertToModelMessages<UIMessage>([systemMessage, ...maskedUiMessages], { tools: opts.tools });
}

function maskContextMessagePart(part: UIMessagePart): UIMessagePart {
	if (part.type === 'text') {
		return { ...part, text: maskPII(part.text) };
	}

	if (part.type === 'reasoning') {
		return { ...part, text: maskPII(part.text) };
	}

	if (part.type === 'dynamic-tool') {
		if (part.state === 'output-available') {
			return {
				...part,
				input: maskPIIValue(part.input),
				output: maskPIIValue(part.output),
			} as UIMessagePart;
		}

		return {
			...part,
			input: maskPIIValue(part.input),
		} as UIMessagePart;
	}

	if (isToolUIPart(part)) {
		return {
			...part,
			input: maskPIIValue(part.input),
			output: maskPIIValue(part.output),
		} as UIMessagePart;
	}

	return part;
}

function getContextWindow({ provider, modelId }: { provider: LlmProvider; modelId: string }): number | null {
	const models = KNOWN_MODELS[provider] ?? [];
	const contextWindow = models.find((m) => m.id === modelId)?.contextWindow;
	return contextWindow ?? null;
}
