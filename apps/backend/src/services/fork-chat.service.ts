import { convertToModelMessages } from 'ai';

import { CompactionLLM, MAX_OUTPUT_TOKENS } from '../agents/compaction';
import { LLM_PROVIDERS } from '../agents/providers';
import * as chatQueries from '../queries/chat.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { UIMessage } from '../types/chat';
import { LlmProvider } from '../types/llm';
import { getEnvModelSelections, resolveProviderModel } from '../utils/llm';
import { compactionService } from './compaction';
import { tokenCounter } from './token-counter';

export async function forkChat(opts: {
	sourceChatId: string;
	projectId: string;
	userId: string;
	sourceTitle: string;
	sourceAuthorName: string;
}): Promise<{ chatId: string }> {
	const rawMessages = await chatQueries.loadChatMessages(opts.sourceChatId);
	const messages = compactionService.useLastCompaction(rawMessages);
	const seededMessages = await buildForkContext(messages, opts.projectId);

	const savedChat = await chatQueries.createForkedChat(
		{
			projectId: opts.projectId,
			userId: opts.userId,
			title: opts.sourceTitle,
			sourceInfo: {
				id: opts.sourceChatId,
				title: opts.sourceTitle,
				authorName: opts.sourceAuthorName,
			},
		},
		seededMessages,
	);

	return { chatId: savedChat.id };
}

async function buildForkContext(
	messages: Array<Omit<UIMessage, 'id'>>,
	projectId: string,
): Promise<Array<Omit<UIMessage, 'id'>>> {
	const totalTokens = tokenCounter.estimate(JSON.stringify(messages));
	if (totalTokens <= MAX_OUTPUT_TOKENS) {
		return messages;
	}

	return compressToFitBudget(messages, projectId);
}

async function compressToFitBudget(
	messages: Array<Omit<UIMessage, 'id'>>,
	projectId: string,
): Promise<Array<Omit<UIMessage, 'id'>>> {
	const [recentMessages, olderMessages] = partitionByTokenBudget(messages, MAX_OUTPUT_TOKENS / 2);

	const summary = await summarizeMessages(olderMessages, projectId);
	if (!summary) {
		return recentMessages;
	}

	const summaryMessage: Omit<UIMessage, 'id'> = {
		role: 'assistant',
		parts: [{ type: 'text', text: summary }],
	};
	return [summaryMessage, ...recentMessages];
}

function partitionByTokenBudget(
	messages: Array<Omit<UIMessage, 'id'>>,
	recentBudget: number,
): [recent: Array<Omit<UIMessage, 'id'>>, older: Array<Omit<UIMessage, 'id'>>] {
	const recent: Array<Omit<UIMessage, 'id'>> = [];
	let tokenCount = 0;

	for (let i = messages.length - 1; i >= 0; i--) {
		const msgTokens = tokenCounter.estimate(JSON.stringify(messages[i]));
		if (tokenCount + msgTokens > recentBudget) {
			break;
		}
		recent.unshift(messages[i]);
		tokenCount += msgTokens;
	}

	const olderCount = messages.length - recent.length;
	return [recent, messages.slice(0, olderCount)];
}

async function summarizeMessages(messages: Array<Omit<UIMessage, 'id'>>, projectId: string): Promise<string | null> {
	if (messages.length === 0) {
		return null;
	}

	const provider = await resolveProjectProvider(projectId);
	if (!provider) {
		return null;
	}

	const modelId = LLM_PROVIDERS[provider].extractorModelId;
	const model = await resolveProviderModel(projectId, provider, modelId);
	if (!model) {
		return null;
	}

	const llm = new CompactionLLM(model, tokenCounter);
	const messagesWithIds = messages.map((m) => ({ ...m, id: crypto.randomUUID() }));
	const modelMessages = await convertToModelMessages(messagesWithIds, { tools: {} });
	const { summary } = await llm.compact(modelMessages);
	return summary;
}

async function resolveProjectProvider(projectId: string): Promise<LlmProvider | null> {
	const configs = await llmConfigQueries.getProjectLlmConfigs(projectId);
	if (configs.length > 0) {
		return configs[0].provider as LlmProvider;
	}
	return getEnvModelSelections().at(0)?.provider ?? null;
}
