import { ModelMessage } from 'ai';

import { AgentSettings } from '../types/agent-settings';
import { UIMessage } from '../types/chat';

const CHARS_PER_TOKEN = 4;
const DEFAULT_COMPACTION_THRESHOLD_TOKENS = 48_000;
const SUMMARY_RETRY_WINDOW_MESSAGES = 16;
const COMPACTION_TAIL_MESSAGE_COUNT = 10;
const FALLBACK_TAIL_MESSAGE_COUNT = 16;

export const SUMMARY_MESSAGE_MARKER = '[NAO_CONVERSATION_SUMMARY]';
export const SUMMARY_NOTICE_TEXT = 'Conversation has been summarized.';
export const SUMMARY_STREAM_MESSAGE = 'Conversation was summarized to continue despite context limits.';
export const SUMMARY_PROMPT = `Summarize the prior conversation for continuation.
Include:
- user goals and intent
- key facts, entities, and decisions
- important constraints and unresolved questions
Keep it concise and factual.
Output plain text only.`;

export interface CompactModelMessagesResult {
	messages: ModelMessage[];
	compacted: boolean;
	summaryMessage?: UIMessage;
	usedFallback: boolean;
}

export class ConversationCompactionService {
	getCompactionTokenThreshold(agentSettings: AgentSettings | null): number {
		const configured = agentSettings?.experimental?.conversationCompactionThresholdTokens;
		if (!configured || configured <= 0) {
			return DEFAULT_COMPACTION_THRESHOLD_TOKENS;
		}
		return configured;
	}

	estimateTokens(messages: ModelMessage[]): number {
		const chars = messages.reduce((sum, message) => sum + this._estimateCharacters(message), 0);
		return Math.ceil(chars / CHARS_PER_TOKEN);
	}

	/**
	 * Compacts model messages when the estimated token count is above the configured threshold.
	 *
	 * Strategy:
	 * 1. Try to summarize older context (retry once with a smaller window).
	 * 2. If summary succeeds, keep a compact tail and inject a synthetic summary system message.
	 * 3. If summary still fails, truncate to a short tail (non-blocking fallback).
	 */
	async compactModelMessagesIfNeeded(opts: {
		messages: ModelMessage[];
		tokenThreshold: number;
		generateSummary: (messages: ModelMessage[]) => Promise<string>;
	}): Promise<CompactModelMessagesResult> {
		const { messages, tokenThreshold, generateSummary } = opts;
		if (tokenThreshold <= 0 || this.estimateTokens(messages) < tokenThreshold) {
			return {
				messages,
				compacted: false,
				usedFallback: false,
			};
		}

		const normalizedMessages = this._withoutSummaryMessages(messages);
		const toSummarize = this._messagesToSummarize(normalizedMessages);
		if (toSummarize.length === 0) {
			return {
				messages: this.truncateForFallback(normalizedMessages),
				compacted: true,
				usedFallback: true,
			};
		}

		const attempts: ModelMessage[][] = [
			toSummarize,
			toSummarize.slice(Math.max(0, toSummarize.length - SUMMARY_RETRY_WINDOW_MESSAGES)),
		];
		for (const attempt of attempts) {
			try {
				const summary = (await generateSummary(attempt)).trim();
				if (!summary) {
					continue;
				}

				const summaryMessage = this.createSummaryMessage(summary);
				return {
					messages: this._buildCompactedMessages({
						messages: normalizedMessages,
						summaryContent: this._getSummaryMessageText(summary),
						tokenThreshold,
					}),
					compacted: true,
					summaryMessage,
					usedFallback: false,
				};
			} catch {
				// Retry once with a smaller summary window.
			}
		}

		return {
			messages: this.truncateForFallback(normalizedMessages),
			compacted: true,
			usedFallback: true,
		};
	}

	trimToLastSummary(messages: UIMessage[]): UIMessage[] {
		const indexFromEnd = [...messages].reverse().findIndex((message) => this.isSummaryMessage(message));
		if (indexFromEnd === -1) {
			return messages;
		}
		const absoluteIndex = messages.length - 1 - indexFromEnd;
		return messages.slice(absoluteIndex);
	}

	createSummaryMessage(summary: string): UIMessage {
		return {
			id: crypto.randomUUID(),
			role: 'system',
			parts: [{ type: 'text', text: this._getSummaryMessageText(summary) }],
		};
	}

	isSummaryMessage(message: UIMessage): boolean {
		if (message.role !== 'system') {
			return false;
		}
		return message.parts.some(
			(part) => part.type === 'text' && part.text.trimStart().startsWith(SUMMARY_MESSAGE_MARKER),
		);
	}

	truncateForFallback(messages: ModelMessage[]): ModelMessage[] {
		const normalizedMessages = this._withoutSummaryMessages(messages);
		const { leadingSystemMessages, conversationMessages } = this._splitLeadingSystemMessages(normalizedMessages);
		const tail = conversationMessages.slice(-FALLBACK_TAIL_MESSAGE_COUNT);
		return [...leadingSystemMessages, ...tail];
	}

	private _buildCompactedMessages(opts: {
		messages: ModelMessage[];
		summaryContent: string;
		tokenThreshold: number;
	}): ModelMessage[] {
		const { messages, summaryContent, tokenThreshold } = opts;
		const { leadingSystemMessages, conversationMessages } = this._splitLeadingSystemMessages(messages);
		const summaryMessage: ModelMessage = { role: 'system', content: summaryContent };

		const lastUserIndex = this._findLastIndex(conversationMessages, (message) => message.role === 'user');
		let compactedTail: ModelMessage[];
		if (lastUserIndex === -1) {
			compactedTail = conversationMessages.slice(-COMPACTION_TAIL_MESSAGE_COUNT);
		} else {
			const lastUserMessage = conversationMessages[lastUserIndex];
			const afterLastUser = conversationMessages.slice(lastUserIndex + 1);
			compactedTail = [lastUserMessage, ...afterLastUser.slice(-COMPACTION_TAIL_MESSAGE_COUNT)];
		}

		let compacted = [...leadingSystemMessages, summaryMessage, ...compactedTail];
		while (compactedTail.length > 1 && this.estimateTokens(compacted) > tokenThreshold) {
			compactedTail = compactedTail.slice(1);
			compacted = [...leadingSystemMessages, summaryMessage, ...compactedTail];
		}

		return compacted;
	}

	private _withoutSummaryMessages(messages: ModelMessage[]): ModelMessage[] {
		return messages.filter((message) => !this._isSummaryModelMessage(message));
	}

	private _splitLeadingSystemMessages(messages: ModelMessage[]): {
		leadingSystemMessages: ModelMessage[];
		conversationMessages: ModelMessage[];
	} {
		const leadingSystemMessages: ModelMessage[] = [];
		let startIndex = 0;

		for (const message of messages) {
			if (message.role !== 'system') {
				break;
			}
			startIndex++;
			if (!this._isSummaryModelMessage(message)) {
				leadingSystemMessages.push(message);
			}
		}

		return {
			leadingSystemMessages,
			conversationMessages: messages.slice(startIndex),
		};
	}

	private _messagesToSummarize(messages: ModelMessage[]): ModelMessage[] {
		const { conversationMessages } = this._splitLeadingSystemMessages(messages);
		const lastUserIndex = this._findLastIndex(conversationMessages, (message) => message.role === 'user');
		if (lastUserIndex === -1) {
			return conversationMessages;
		}
		return conversationMessages.slice(0, lastUserIndex);
	}

	private _isSummaryModelMessage(message: ModelMessage): boolean {
		if (message.role !== 'system') {
			return false;
		}
		const text = this._extractText(message.content);
		return text.trimStart().startsWith(SUMMARY_MESSAGE_MARKER);
	}

	private _getSummaryMessageText(summary: string): string {
		return `${SUMMARY_MESSAGE_MARKER}\n${summary}`;
	}

	private _estimateCharacters(value: unknown): number {
		if (typeof value === 'string') {
			return value.length;
		}
		if (Array.isArray(value)) {
			return value.reduce((sum, part) => sum + this._estimateCharacters(part), 0);
		}
		if (value === null || value === undefined) {
			return 0;
		}
		if (typeof value === 'object') {
			const text = this._extractText(value);
			if (text) {
				return text.length;
			}
			return JSON.stringify(value).length;
		}
		return String(value).length;
	}

	private _extractText(value: unknown): string {
		if (typeof value === 'string') {
			return value;
		}
		if (Array.isArray(value)) {
			return value.map((item) => this._extractText(item)).join('\n');
		}
		if (!value || typeof value !== 'object') {
			return '';
		}

		const withText = value as { text?: unknown; content?: unknown };
		if (typeof withText.text === 'string') {
			return withText.text;
		}
		if (withText.content !== undefined) {
			return this._extractText(withText.content);
		}

		return '';
	}

	private _findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
		for (let i = items.length - 1; i >= 0; i--) {
			if (predicate(items[i])) {
				return i;
			}
		}
		return -1;
	}
}

export const conversationCompactionService = new ConversationCompactionService();
