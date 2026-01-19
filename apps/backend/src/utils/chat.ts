import { LanguageModelUsage } from 'ai';

import { TokenUsage } from '../types/chat';

export const spreadTokenUsage = (usage: LanguageModelUsage): TokenUsage => ({
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
