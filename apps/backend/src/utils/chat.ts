import { LanguageModelUsage } from 'ai';

import { LLM_PROVIDERS } from '../agents/providers';
import * as projectQueries from '../queries/project.queries';
import { DBProject } from '../queries/project-slack-config.queries';
import { TokenCost, TokenUsage } from '../types/chat';
import { LlmProvider } from '../types/llm';

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
