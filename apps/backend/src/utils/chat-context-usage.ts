import { markSupersededExecuteSqlParts } from '@nao/shared/execute-sql-parts';
import { type LlmSelectedModel } from '@nao/shared/types';
import { convertToModelMessages, type ModelMessage, type Tool } from 'ai';

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
import { resolveAvailableUserGroupAccess } from '../services/user-group-availability.service';
import type { ContextUsage, UIMessage } from '../types/chat';
import { resolveContextWindow } from './llm';

export async function getChatContextUsage(opts: {
	chatId: string;
	userId: string;
	model?: LlmSelectedModel;
	projectId?: string;
}): Promise<ContextUsage | null> {
	const projectId = opts.projectId ?? (await chatQueries.getChatProjectId(opts.chatId));
	if (!projectId) {
		return null;
	}
	const [project, agentSettings, userGroupAccess] = await Promise.all([
		projectQueries.getProjectById(projectId),
		projectQueries.getAgentSettings(projectId),
		resolveAvailableUserGroupAccess(projectId, opts.userId),
	]);
	const semanticLayerMode = project?.path
		? resolveSemanticLayerMode(project.path, agentSettings, userGroupAccess.semanticLayerModeOverride)
		: null;
	const tools = getTools(agentSettings, undefined, { semanticLayerMode });
	const messages = await getChatAsModelMessages({ ...opts, projectId, tools });
	const messageTokens = tokenCounter.estimateMessages(messages);
	const toolTokens = await tokenCounter.estimateTools(tools);
	return {
		tokensUsed: messageTokens + toolTokens,
		contextWindow: opts.model ? await resolveContextWindow(projectId, opts.model) : null,
	};
}

export async function getChatAsModelMessages(opts: {
	chatId: string;
	userId: string;
	projectId: string;
	tools: Record<string, Tool>;
}): Promise<ModelMessage[]> {
	const uiMessages = markSupersededExecuteSqlParts(
		await chatQueries.getChatMessages(opts.chatId, { queryResultPreviews: true }),
	);
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
