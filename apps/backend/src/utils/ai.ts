import { LanguageModelUsage, ModelMessage } from 'ai';

import { LLM_PROVIDERS } from '../agents/providers';
import { type ITokenCounter, tokenCounter } from '../services/token-counter';
import { CompactionPart, TokenCost, TokenUsage, UIMessage } from '../types/chat';
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

export const extractLastTextFromMessage = (message: UIMessage): string => {
	for (let i = message.parts.length - 1; i >= 0; i--) {
		const part = message.parts[i];
		if (part.type === 'text' && part.text) {
			return part.text;
		}
	}
	return '';
};

export const findLastUserMessage = (
	messages: UIMessage[],
	{
		beforeIdx,
	}: {
		beforeIdx?: number;
	} = {},
): [message: UIMessage, idx: number] | [undefined, undefined] => {
	// Start at beforeIdx if provided, otherwise start at the end of the messages
	const endIdx = Math.min(messages.length - 1, beforeIdx ?? Infinity);
	for (let i = endIdx; i >= 0; i--) {
		if (messages[i].role === 'user') {
			return [messages[i], i];
		}
	}
	return [undefined, undefined];
};

export const getLastUserMessageText = (messages: UIMessage[]): string => {
	const [lastUserMessage] = findLastUserMessage(messages);
	if (!lastUserMessage) {
		return '';
	}
	return extractLastTextFromMessage(lastUserMessage);
};

export type EstimateTokensType = 'text' | 'json';

const CHARS_PER_TOKEN = {
	text: 4,
	json: 3,
} as const;

/** Estimates the number of tokens in a text. */
export function estimateTokens(text: string, type?: EstimateTokensType): number {
	const charsPerToken = CHARS_PER_TOKEN[type ?? 'text'];
	return Math.ceil(text.length / charsPerToken);
}

export const createChatTitle = ({ text }: { text: string }) => {
	return text.slice(0, 64);
};

export const joinAllTextParts = (message: UIMessage, separator: string = '\n'): string => {
	return message.parts
		.filter((part) => part.type === 'text')
		.map((part) => part.text)
		.join(separator)
		.trim();
};

export function findFirstNonSystemMessageIndex(messages: ModelMessage[]): number {
	for (let i = 0; i < messages.length; i++) {
		if (messages[i].role !== 'system') {
			return i;
		}
	}
	return -1;
}

export function findLastUserMessageIndex(messages: ModelMessage[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'user') {
			return i;
		}
	}
	return -1;
}

export function findLastCompactionPart(
	messages: UIMessage[],
): [CompactionPart, messageIdx: number] | [undefined, undefined] {
	for (let i = messages.length - 1; i >= 0; i--) {
		for (const part of messages[i].parts) {
			if (part.type === 'data-compaction') {
				return [part.data, i];
			}
		}
	}

	return [undefined, undefined];
}

/**
 * Selects as many messages from the end of the conversation that fit within the given budget.
 */
export function selectMessagesInBudget(
	messages: ModelMessage[],
	budget: number,
	tc: ITokenCounter = tokenCounter,
): ModelMessage[] {
	const selectedMessages: ModelMessage[] = [];
	let tokenCount = 0;

	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		const messageTokens = tc.estimateMessages([message]);

		if (message.role === 'tool') {
			const assistantMessage = messages[i - 1];
			if (!assistantMessage || assistantMessage.role !== 'assistant') {
				break;
			}
			const assistantMessageTokens = tc.estimateMessages([assistantMessage]);
			if (tokenCount + assistantMessageTokens + messageTokens > budget) {
				break;
			}
			selectedMessages.unshift(assistantMessage, message);
			tokenCount += assistantMessageTokens + messageTokens;
			i--; // skip the assistant message already included as part of the pair
			continue;
		}

		if (tokenCount + messageTokens > budget) {
			break;
		}
		selectedMessages.unshift(message);
		tokenCount += messageTokens;
	}

	return selectedMessages;
}
