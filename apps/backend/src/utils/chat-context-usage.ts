import { markSupersededExecuteSqlParts } from '@nao/shared/execute-sql-parts';
import { type LlmProvider } from '@nao/shared/types';
import { convertToModelMessages, type ModelMessage, type Tool } from 'ai';

import { getContextWindow } from '../agents/providers';
import { getTools } from '../agents/tools';
import { SystemPrompt } from '../components/ai';
import { renderToMarkdown } from '../lib/markdown';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import { appendChatArtifacts, collapseStoryToolOutputs, safeGetChatArtifacts } from '../services/chat-artifacts';
import { compactionService } from '../services/compaction';
import { memoryService } from '../services/memory';
import { resolveSemanticLayerMode } from '../services/semantic-layer.service';
import { tokenCounter } from '../services/token-counter';
import type { ContextUsage, UIMessage } from '../types/chat';

export async function getChatContextUsage(opts: {
	chatId: string;
	userId: string;
	model?: { provider: LlmProvider; modelId: string };
	projectId?: string;
}): Promise<ContextUsage | null> {
	const projectId = opts.projectId ?? (await chatQueries.getChatProjectId(opts.chatId));
	if (!projectId) {
		return null;
	}
	const [project, agentSettings] = await Promise.all([
		projectQueries.getProjectById(projectId),
		projectQueries.getAgentSettings(projectId),
	]);
	const semanticLayerMode = project?.path ? resolveSemanticLayerMode(project.path, agentSettings) : null;
	const tools = getTools(agentSettings, undefined, { semanticLayerMode });
	const messages = await getChatAsModelMessages({ ...opts, projectId, tools });
	const messageTokens = tokenCounter.estimateMessages(messages);
	const toolTokens = await tokenCounter.estimateTools(tools);
	return {
		tokensUsed: messageTokens + toolTokens,
		contextWindow: opts.model ? getContextWindow(opts.model.provider, opts.model.modelId) : null,
	};
}

export async function getChatAsModelMessages(opts: {
	chatId: string;
	userId: string;
	projectId: string;
	tools: Record<string, Tool>;
}): Promise<ModelMessage[]> {
	const uiMessages = markSupersededExecuteSqlParts(await chatQueries.getChatMessages(opts.chatId));
	const [memories, artifacts] = await Promise.all([
		memoryService.safeGetUserMemories(opts.userId, opts.projectId, opts.chatId),
		safeGetChatArtifacts(opts.chatId, uiMessages, opts.projectId),
	]);
	const uiMessagesWithCollapsedStories = artifacts ? collapseStoryToolOutputs(uiMessages, artifacts) : uiMessages;
	const uiMessagesWithCompaction = compactionService.useLastCompaction(uiMessagesWithCollapsedStories);
	const uiMessagesWithArtifacts = artifacts
		? appendChatArtifacts(uiMessagesWithCompaction, artifacts)
		: uiMessagesWithCompaction;
	const systemPrompt = renderToMarkdown(SystemPrompt({ memories }));
	const systemMessage: Omit<UIMessage, 'id'> = {
		role: 'system',
		parts: [{ type: 'text', text: systemPrompt }],
	};
	return convertToModelMessages<UIMessage>([systemMessage, ...uiMessagesWithArtifacts], { tools: opts.tools });
}
