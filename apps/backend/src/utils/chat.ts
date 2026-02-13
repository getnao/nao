import { LanguageModelUsage } from 'ai';

import { LLM_PROVIDERS } from '../agents/providers';
import * as projectQueries from '../queries/project.queries';
import { DBProject } from '../queries/project-slack-config.queries';
import { TokenCost, TokenUsage, UIMessage } from '../types/chat';
import { LlmProvider } from '../types/llm';

const SKILL_COMMAND_PATTERN = /^\/([a-zA-Z0-9_-]+)(?:\s|$)/;

export const convertToTokenUsage = (usage: LanguageModelUsage): TokenUsage => ({
	inputTotalTokens: usage.inputTokens,
	inputNoCacheTokens: usage.inputTokenDetails.noCacheTokens,
	inputCacheReadTokens: usage.inputTokenDetails.cacheReadTokens,
	inputCacheWriteTokens:
		usage.inputTokenDetails.cacheWriteTokens !== undefined ? usage.inputTokenDetails.cacheWriteTokens : 0,
	outputTotalTokens: usage.outputTokens,
	outputTextTokens: usage.outputTokenDetails.textTokens,
	outputReasoningTokens: usage.outputTokenDetails.reasoningTokens,
	totalTokens: usage.totalTokens,
});

export const convertToCost = (usage: TokenUsage, provider: LlmProvider, modelId: string): TokenCost => {
	const costPerM = LLM_PROVIDERS[provider].models.find((model) => model.id === modelId)?.costPerM;

	if (!costPerM) {
		return {
			inputNoCache: undefined,
			inputCacheRead: undefined,
			inputCacheWrite: undefined,
			output: undefined,
			totalCost: undefined,
		};
	}

	const cost = {
		inputNoCache: ((usage.inputNoCacheTokens ?? 0) * (costPerM.inputNoCache ?? 0)) / 1_000_000,
		inputCacheRead: ((usage.inputCacheReadTokens ?? 0) * (costPerM.inputCacheRead ?? 0)) / 1_000_000,
		inputCacheWrite: ((usage.inputCacheWriteTokens ?? 0) * (costPerM.inputCacheWrite ?? 0)) / 1_000_000,
		output: ((usage.outputTotalTokens ?? 0) * (costPerM.output ?? 0)) / 1_000_000,
	};

	return {
		...cost,
		totalCost: Object.values(cost).reduce((acc, curr) => acc + curr, 0),
	};
};

export const extractLastTextFromMessage = (message: { parts: { type: string; text?: string }[] }): string => {
	for (let i = message.parts.length - 1; i >= 0; i--) {
		const part = message.parts[i];
		if (part.type === 'text' && part.text) {
			return part.text;
		}
	}
	return '';
};

export const retrieveProjectById = async (projectId: string): Promise<DBProject> => {
	const project = await projectQueries.getProjectById(projectId);
	if (!project) {
		throw new Error(`Project not found: ${projectId}`);
	}
	if (!project.path) {
		throw new Error(`Project path not configured: ${projectId}`);
	}
	return project;
};

export const findLastUserMessage = (messages: UIMessage[]): { message: UIMessage; index: number } => {
	let lastUserMessageIndex = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'user') {
			lastUserMessageIndex = i;
			break;
		}
	}
	return { message: messages[lastUserMessageIndex], index: lastUserMessageIndex };
};

export const expandSkillCommand = (
	messages: UIMessage[],
	getSkillContent: (skillName: string) => string | null,
): UIMessage[] => {
	const { message: lastUserMessage, index: lastUserMessageIndex } = findLastUserMessage(messages);

	if (lastUserMessageIndex === -1) {
		return messages;
	}

	const textPart = lastUserMessage.parts.find((part) => part.type === 'text') as { text?: string } | undefined;

	// Early return if no text or doesn't start with '/'
	if (!textPart?.text?.startsWith('/')) {
		return messages;
	}

	const match = textPart.text.match(SKILL_COMMAND_PATTERN);
	if (!match) {
		return messages;
	}

	const skillName = match[1];
	const skillContent = getSkillContent(skillName);

	if (!skillContent) {
		return messages;
	}

	// Replace the message with expanded skill content
	const updatedMessages = [...messages];
	const textPartIndex = lastUserMessage.parts.findIndex((part) => part.type === 'text');
	const newParts = [...lastUserMessage.parts];
	newParts[textPartIndex] = { type: 'text', text: skillContent };
	updatedMessages[lastUserMessageIndex] = { ...lastUserMessage, parts: newParts };

	return updatedMessages;
};
