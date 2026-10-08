import type { LlmProvider } from '@nao/shared/types';
import { isToolUIPart, LanguageModelUsage, ModelMessage, parsePartialJson } from 'ai';

import { getProviderMeta } from '../agents/providers';
import { type ITokenCounter, tokenCounter } from '../services/token-counter';
import { CompactionPart, TokenCost, TokenUsage, UIMessage, UIMessagePart, UIToolPart } from '../types/chat';
import type { CustomModelMetadata, ModelCosts } from '../types/llm';

const SETTLED_TOOL_STATES = new Set<string>(['output-available', 'output-error', 'output-denied']);

const INTERRUPTED_TOOL_ERROR_TEXT = 'The tool call was interrupted by the user before it could complete.';

export const MALFORMED_TOOL_INPUT_ERROR_TEXT =
	'The arguments of this tool call were cut off before they formed valid JSON, so the tool did not run. ' +
	'The input shown is what could be recovered from the partial arguments. ' +
	'If the call is still needed, make it again with complete arguments, splitting the work into smaller calls if they were too long.';

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

export const convertToCost = (
	usage: TokenUsage,
	provider: LlmProvider,
	modelId: string,
	customModels: CustomModelMetadata[] = [],
	costs?: ModelCosts,
): TokenCost => {
	const builtInCosts = getProviderMeta(provider).models.find((model) => model.id === modelId)?.costPerM;
	const declaredCosts = customModels.find((m) => m.id === modelId)?.costPerM;

	// Prices declared for a model win over nao's built-in table, token type by token type.
	const costPerM = builtInCosts || declaredCosts ? { ...builtInCosts, ...declaredCosts } : costs;

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

export const createChatTitle = ({ text }: { text: string }) => {
	return text.slice(0, 64);
};

export const checkAssistantMessageHasContent = (message: UIMessage): boolean =>
	message.parts.some(
		(part) =>
			part.type !== 'step-start' &&
			part.type !== 'tool-suggest_follow_ups' &&
			part.type !== 'reasoning' &&
			part.type !== 'data-newChat' &&
			part.type !== 'data-newUserMessage',
	);

export const joinAllTextParts = (message: UIMessage, separator: string = '\n'): string => {
	return message.parts
		.filter((part) => part.type === 'text')
		.map((part) => part.text)
		.join(separator)
		.trim();
};

/** Leaves every tool part in a settled state the next model request can be built from. */
export function settleToolParts(messages: UIMessage[]): Promise<UIMessage[]> {
	return recoverMalformedToolInputs(settleInterruptedToolParts(messages));
}

export function settleInterruptedToolParts(messages: UIMessage[]): UIMessage[] {
	return messages.map((message) => {
		if (message.role !== 'assistant') {
			return message;
		}
		let changed = false;
		const newParts = message.parts.map((part) => {
			if (!isToolUIPart(part) || isToolPartSettled(part)) {
				return part;
			}
			changed = true;
			return {
				...part,
				state: 'output-error',
				input: part.input ?? {},
				errorText: INTERRUPTED_TOOL_ERROR_TEXT,
			} as UIMessagePart;
		});
		return changed ? { ...message, parts: newParts } : message;
	});
}

/** A preliminary output is progress a still-running tool streamed, not a settled result. */
function isToolPartSettled(part: Extract<UIMessagePart, { state: string }>): boolean {
	const isPreliminary = 'preliminary' in part && part.preliminary === true;
	return SETTLED_TOOL_STATES.has(part.state) && !isPreliminary;
}

/**
 * A tool call cut off mid-arguments (max output tokens, a dropped stream) fails as `output-error`
 * with no `input` and the raw, unbalanced JSON text in `rawInput`. `convertToModelMessages` would
 * send that text back as the tool-call input on the next turn, which providers reject. The call is
 * given the object recoverable from the partial text and an error the model can act on instead.
 */
export async function recoverMalformedToolInputs(messages: UIMessage[]): Promise<UIMessage[]> {
	return Promise.all(messages.map(recoverMessageToolInputs));
}

async function recoverMessageToolInputs(message: UIMessage): Promise<UIMessage> {
	if (message.role !== 'assistant') {
		return message;
	}
	let changed = false;
	const newParts = await Promise.all(
		message.parts.map(async (part) => {
			if (!isToolUIPart(part) || !hasMalformedInput(part)) {
				return part;
			}
			changed = true;
			return {
				...part,
				input: await recoverToolInput(part),
				errorText: MALFORMED_TOOL_INPUT_ERROR_TEXT,
			} as UIMessagePart;
		}),
	);
	return changed ? { ...message, parts: newParts } : message;
}

function hasMalformedInput(part: UIToolPart): boolean {
	return part.state === 'output-error' && !isPlainObject(part.input);
}

async function recoverToolInput(part: UIToolPart): Promise<Record<string, unknown>> {
	const candidates = [part.input, 'rawInput' in part ? part.rawInput : undefined];
	for (const candidate of candidates) {
		const value = typeof candidate === 'string' ? (await parsePartialJson(candidate)).value : candidate;
		if (isPlainObject(value)) {
			return value;
		}
	}
	return {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
			if (part.type === 'data-compaction' && (part.data.summary ?? '').trim() !== '') {
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
