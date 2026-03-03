import { ModelMessage, Tool } from 'ai';

import { CompactionLLM } from '../agents/compaction';
import { LLM_PROVIDERS } from '../agents/providers';
import type { DBChat } from '../db/abstractSchema';
import { renderToMarkdown, XML } from '../lib/markdown';
import type { CompactionPart, TokenUsage, UIMessage } from '../types/chat';
import { ICompactionLLM } from '../types/compaction';
import type { LlmProvider } from '../types/llm';
import {
	findFirstNonSystemMessageIndex,
	findLastCompactionPart,
	findLastUserMessage,
	findLastUserMessageIndex,
} from '../utils/ai';
import { debugCompaction } from '../utils/debug';
import { resolveProviderModel } from '../utils/llm';
import { scheduleSaveLlmInferenceRecord } from '../utils/schedule-task';
import { ITokenCounter, TokenCounter } from './token-counter';

const CONTEXT_WINDOW_COMPACTION_THRESHOLD = 0.75;

interface CompactIfNeededOptions extends CompactConversationOptions {
	onCompactionStarted: () => void;
	onCompactionFinished: (result: CompactionPart) => void;
}

interface CompactionResult {
	summary: string;
	usage: TokenUsage;
}

interface CompactConversationOptions {
	chat: Pick<DBChat, 'id' | 'projectId' | 'userId'>;
	provider: LlmProvider;
	messages: ModelMessage[];
	tools: Record<string, Tool>;
	maxOutputTokens: number;
	contextWindow: number;
}

interface CompactionServiceOptions {
	createCompactionLlm: (...args: ConstructorParameters<typeof CompactionLLM>) => ICompactionLLM;
	tokenCounter: ITokenCounter;
}

export class CompactionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CompactionError';
	}
}

export class CompactionService {
	private readonly _tc: ITokenCounter;

	constructor(private readonly options: CompactionServiceOptions) {
		this._tc = options.tokenCounter;
	}

	/** Rebuilds conversation history from the latest stored compaction marker. */
	useLastCompaction(messages: UIMessage[]): Omit<UIMessage, 'id'>[] {
		const [lastCompaction, messageIdx] = findLastCompactionPart(messages);
		if (!lastCompaction) {
			return messages;
		}

		return this._addPartialSummary(messages, lastCompaction.summary, messageIdx);
	}

	/** Rehydrates a partial compaction by prepending the summary to remaining recent messages. */
	private _addPartialSummary(
		messages: UIMessage[],
		compactionSummary: string,
		compactionMessageIdx: number,
	): Omit<UIMessage, 'id'>[] {
		const [_, userMessageBeforeCompactionIdx] = findLastUserMessage(messages, { beforeIdx: compactionMessageIdx });
		if (userMessageBeforeCompactionIdx === undefined) {
			return messages;
		}

		const selectedMessages = messages.slice(userMessageBeforeCompactionIdx);
		return [this._createSummaryUIMessage(compactionSummary), ...selectedMessages];
	}

	private _createSummaryUIMessage(summary: string): Omit<UIMessage, 'id'> {
		return {
			role: 'assistant',
			parts: [{ type: 'text', text: summary }],
		};
	}

	/**
	 * Triggers compaction if the conversation exceeds the configured threshold.
	 */
	async compactConversationIfNeeded({
		onCompactionStarted,
		onCompactionFinished,
		...opts
	}: CompactIfNeededOptions): Promise<CompactionPart | undefined> {
		const shouldCompact = await this._shouldCompact(opts);
		if (!shouldCompact) {
			return undefined;
		}

		onCompactionStarted();

		try {
			const result = await this._compactConversation(opts);
			onCompactionFinished(result);
			return result;
		} catch (error) {
			onCompactionFinished({ summary: '', error: String(error) });
			return undefined;
		}
	}

	private async _shouldCompact({
		messages,
		tools,
		maxOutputTokens,
		contextWindow,
	}: CompactConversationOptions): Promise<boolean> {
		const messageTokens = this._tc.estimateMessages(messages);
		const toolTokens = await this._tc.estimateTools(tools);
		const total = messageTokens + toolTokens + maxOutputTokens;
		const threshold = contextWindow * CONTEXT_WINDOW_COMPACTION_THRESHOLD;

		debugCompaction('token estimate', { messageTokens, toolTokens, total, threshold });
		return total > threshold;
	}

	/**
	 * Compacts the conversation by summarizing the messages up to the latest user message (last user/assistant turn).
	 * All messages after the last user message are kept veribatim in the conversation.
	 */
	private async _compactConversation(opts: CompactConversationOptions): Promise<CompactionResult> {
		const lastUserIndex = this._findLastUserMessageIndex(opts.messages);
		const firstNonSystemIndex = this._findFirstNonSystemMessageIndex(opts.messages);

		if (firstNonSystemIndex > lastUserIndex) {
			throw new CompactionError('User message must come after the first non-system message.');
		}

		const llm = await this._resolveCompactionLLM(opts.chat.projectId, opts.provider);
		if (!llm) {
			throw new CompactionError('Failed to resolve LLM.');
		}

		const result = await this._compactUpToLastUserMessage(llm, opts, firstNonSystemIndex, lastUserIndex);
		this._trackInference(opts, llm.modelId, result.usage);

		return result;
	}

	private _findLastUserMessageIndex(messages: ModelMessage[]): number {
		const index = findLastUserMessageIndex(messages);
		if (index === -1) {
			throw new CompactionError('Messages must contain a user message.');
		}
		return index;
	}

	private _findFirstNonSystemMessageIndex(messages: ModelMessage[]): number {
		const index = findFirstNonSystemMessageIndex(messages);
		if (index === -1) {
			throw new CompactionError('Messages must contain a non-system message.');
		}
		return index;
	}

	private async _resolveCompactionLLM(projectId: string, provider: LlmProvider) {
		const modelId = LLM_PROVIDERS[provider].extractorModelId;
		const model = await resolveProviderModel(projectId, provider, modelId);
		if (!model) {
			return undefined;
		}
		return this.options.createCompactionLlm(model, this._tc);
	}

	/** Summarizes conversation up to the latest user message and replaces that range in-place. */
	private async _compactUpToLastUserMessage(
		llm: ICompactionLLM,
		opts: CompactConversationOptions,
		firstNonSystemIndex: number,
		lastUserIndex: number,
	): Promise<CompactionResult> {
		if (firstNonSystemIndex === lastUserIndex) {
			throw new CompactionError('Conversation must contain non-system messages before the user message.');
		}

		const messagesToSummarize = opts.messages.slice(firstNonSystemIndex, lastUserIndex);
		const { summary, usage } = await llm.compact(messagesToSummarize);

		this._replaceCompactedMessages(
			opts.messages,
			messagesToSummarize,
			firstNonSystemIndex,
			this._createSummaryModelMessage(summary),
		);

		return { summary, usage };
	}

	private _createSummaryModelMessage(summary: string): ModelMessage {
		return {
			role: 'assistant',
			content: renderToMarkdown(
				XML({
					tag: 'conversation-summary',
					children: [summary],
				}),
			),
		};
	}

	/** Replaces the compacted messages in-place. */
	private _replaceCompactedMessages(
		messages: ModelMessage[],
		compactedMessages: ModelMessage[],
		startIndex: number,
		...newMessages: ModelMessage[]
	) {
		messages.splice(startIndex, compactedMessages.length, ...newMessages);
	}

	private _trackInference(opts: CompactConversationOptions, modelId: string, usage: TokenUsage) {
		scheduleSaveLlmInferenceRecord({
			type: 'compaction',
			projectId: opts.chat.projectId,
			userId: opts.chat.userId,
			chatId: opts.chat.id,
			llmProvider: opts.provider,
			llmModelId: modelId,
			...usage,
		});
	}
}

export const compactionService = new CompactionService({
	createCompactionLlm: (...args) => new CompactionLLM(...args),
	tokenCounter: new TokenCounter(),
});
