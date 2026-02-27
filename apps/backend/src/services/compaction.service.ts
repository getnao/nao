import { ModelMessage } from 'ai';

import { CompactionLLM } from '../agents/compaction/compaction-llm';
import { LLM_PROVIDERS } from '../agents/providers';
import { AgentTools, CompactionSummaryType, TokenUsage, UIMessage } from '../types/chat';
import { LlmProvider } from '../types/llm';
import { estimateMessagesTokens, estimateMessageTokens, estimateToolsTokens, findLastUserMessage } from '../utils/ai';
import { debugCompaction } from '../utils/debug';
import { resolveProviderModel } from '../utils/llm';
import { scheduleSaveLlmInferenceRecord } from '../utils/schedule-task';

const CONTEXT_WINDOW_COMPACTION_THRESHOLD = 0.75;
const SUMMARY_MAX_TOKENS = 8_000;

interface CompactIfNeededOptions extends CompactConversationOptions {
	onCompactionStarted: () => void;
	onCompactionFinished: (result: CompactionResult) => void;
}

interface CompactConversationOptions {
	chatId: string;
	projectId: string;
	userId: string;
	provider: LlmProvider;
	messages: ModelMessage[];
	tools: AgentTools;
	maxOutputTokens: number;
	contextWindow: number;
}

export interface CompactionResult {
	summary: string;
	summaryType: 'partial' | 'full';
}

type CompactionLlmClient = Pick<CompactionLLM, 'compact'>;

interface CompactionServiceOptions {
	createCompactionLlm: (model: ConstructorParameters<typeof CompactionLLM>[0]) => CompactionLlmClient;
}

export class CompactionService {
	constructor(private readonly options: CompactionServiceOptions) {}

	/**
	 * Reconstructs messages from stored UI messages using the last compaction summary.
	 *
	 * Case 1 (partial / history compaction): [SUMMARY, user_msg, ...rest]
	 * Case 2 (full / turn compaction):       [USER_MSG, SUMMARY, trimmed_assistant, ...rest]
	 */
	useLastCompaction(messages: UIMessage[]): Omit<UIMessage, 'id'>[] {
		const lastCompaction = findLastCompactionSummary(messages);
		if (!lastCompaction) {
			return messages;
		}

		if (lastCompaction.summaryType === 'full') {
			return this._rebuildAfterTurnCompaction(messages, lastCompaction);
		}

		const rest = extractMessagesNotSummarized(messages, lastCompaction.idx);
		return [
			{
				role: 'assistant',
				parts: [{ type: 'text', text: lastCompaction.summary }],
			},
			...rest,
		];
	}

	/**
	 * Reconstructs messages after a turn compaction.
	 * Finds the original user message from stored messages, places it before
	 * the summary, and only includes assistant parts that came after the compaction marker.
	 */
	private _rebuildAfterTurnCompaction(
		messages: UIMessage[],
		compaction: { summary: string; idx: number },
	): Omit<UIMessage, 'id'>[] {
		const [userMessage] = findLastUserMessage(messages, compaction.idx);
		const assistantMsg = messages[compaction.idx];
		const compactionPartIndex = assistantMsg.parts.findIndex((p) => p.type === 'data-compaction');
		const remainingParts = assistantMsg.parts.slice(compactionPartIndex + 1);
		const rest = messages.slice(compaction.idx + 1);

		return [
			...(userMessage ? [userMessage] : []),
			{ role: 'assistant', parts: [{ type: 'text', text: compaction.summary }] },
			...(remainingParts.length > 0 ? [{ ...assistantMsg, parts: remainingParts }] : []),
			...rest,
		];
	}

	async compactConversationIfNeeded({
		onCompactionStarted,
		onCompactionFinished,
		...opts
	}: CompactIfNeededOptions): Promise<CompactionResult | undefined> {
		const shouldCompact = await this._shouldCompact(opts);
		if (!shouldCompact) {
			return undefined;
		}

		onCompactionStarted();
		const result = await this._compactConversation(opts);
		if (result) {
			onCompactionFinished(result);
		}
		return result;
	}

	private async _shouldCompact({
		messages,
		tools,
		maxOutputTokens,
		contextWindow,
	}: CompactConversationOptions): Promise<boolean> {
		const messageTokens = estimateMessagesTokens(messages);
		const toolTokens = await estimateToolsTokens(tools);
		const total = messageTokens + toolTokens + maxOutputTokens;

		debugCompaction('token estimate', { messageTokens, toolTokens, total, contextWindow });

		return total > contextWindow * CONTEXT_WINDOW_COMPACTION_THRESHOLD;
	}

	private async _compactConversation(opts: CompactConversationOptions): Promise<CompactionResult | undefined> {
		const { messages } = opts;
		const lastUserIndex = findLastUserMessageIndex(messages);
		if (lastUserIndex < 1) {
			return;
		}

		const compactionType = await this._determineCompactionType(opts, lastUserIndex);

		debugCompaction('compaction type', { compactionType, lastUserIndex, messageCount: messages.length });

		if (compactionType === 'partial') {
			return this._compactPartial(opts, lastUserIndex);
		}
		return this._compactFull(opts, lastUserIndex);
	}

	/**
	 * Determines whether history-only compaction is sufficient, or if we need
	 * to also compact the current turn. We estimate whether replacing the
	 * history with a summary (max 8k tokens) would fit within the context window.
	 */
	private async _determineCompactionType(
		{ messages, tools, maxOutputTokens, contextWindow }: CompactConversationOptions,
		lastUserIndex: number,
	): Promise<CompactionSummaryType> {
		const historyMessages = messages.slice(1, lastUserIndex);
		if (historyMessages.length === 0) {
			return 'full';
		}

		const systemTokens = estimateMessageTokens(messages[0]);
		const currentTurnTokens = estimateMessagesTokens(messages.slice(lastUserIndex));
		const toolTokens = await estimateToolsTokens(tools);
		const totalAfterHistoryCompaction =
			systemTokens + SUMMARY_MAX_TOKENS + currentTurnTokens + toolTokens + maxOutputTokens;

		return totalAfterHistoryCompaction > contextWindow ? 'full' : 'partial';
	}

	/**
	 * Case 1: Summarize messages before the current turn.
	 * Mutates messages to: [system, summary, user_msg, ...turn_rest]
	 */
	private async _compactPartial(
		opts: CompactConversationOptions,
		lastUserIndex: number,
	): Promise<CompactionResult | undefined> {
		const { messages } = opts;
		const messagesToSummarize = messages.slice(1, lastUserIndex);
		if (messagesToSummarize.length === 0) {
			return;
		}

		const resolved = await this._resolveLLM(opts.projectId, opts.provider);
		if (!resolved) {
			return;
		}

		const { summary, usage } = await resolved.llm.compact(messagesToSummarize);
		this._trackUsage(opts, resolved.modelId, usage);

		messages.splice(1, lastUserIndex - 1, { role: 'assistant', content: summary });
		return { summary, summaryType: 'partial' };
	}

	/**
	 * Case 2: Summarize the entire conversation including the current turn's
	 * assistant messages. Keeps the user prompt verbatim before the summary.
	 * Mutates messages to: [system, user_msg, summary]
	 */
	private async _compactFull(
		opts: CompactConversationOptions,
		lastUserIndex: number,
	): Promise<CompactionResult | undefined> {
		const { messages } = opts;
		const turnMessages = messages.slice(lastUserIndex + 1);
		if (turnMessages.length === 0) {
			return;
		}

		const resolved = await this._resolveLLM(opts.projectId, opts.provider);
		if (!resolved) {
			return;
		}

		const userMessage = messages[lastUserIndex];
		const messagesToSummarize = [...messages.slice(1, lastUserIndex), ...turnMessages];
		const { summary, usage } = await resolved.llm.compact(messagesToSummarize);
		this._trackUsage(opts, resolved.modelId, usage);

		messages.splice(1, messages.length - 1, userMessage, { role: 'assistant', content: summary });

		return { summary, summaryType: 'full' };
	}

	private async _resolveLLM(projectId: string, provider: LlmProvider) {
		const modelId = LLM_PROVIDERS[provider].extractorModelId;
		const model = await resolveProviderModel(projectId, provider, modelId);
		if (!model) {
			return undefined;
		}
		const llm = this.options.createCompactionLlm(model);
		return { llm, modelId };
	}

	private _trackUsage(opts: CompactConversationOptions, modelId: string, usage: TokenUsage) {
		scheduleSaveLlmInferenceRecord({
			type: 'compaction',
			projectId: opts.projectId,
			userId: opts.userId,
			chatId: opts.chatId,
			llmProvider: opts.provider,
			llmModelId: modelId,
			...usage,
		});
	}
}

function findLastUserMessageIndex(messages: ModelMessage[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'user') {
			return i;
		}
	}
	return -1;
}

export const compactionService = new CompactionService({
	createCompactionLlm: (model) => new CompactionLLM(model),
});

function findLastCompactionSummary(
	messages: UIMessage[],
): { summary: string; summaryType?: 'partial' | 'full'; idx: number } | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		for (const part of messages[i].parts) {
			if (part.type === 'data-compaction') {
				return { summary: part.data.summary, summaryType: part.data.summaryType, idx: i };
			}
		}
	}
	return undefined;
}

function extractMessagesNotSummarized(messages: UIMessage[], lastSummaryMessageIdx: number = 0): UIMessage[] {
	const [_, lastUserIndex] = findLastUserMessage(messages, lastSummaryMessageIdx);
	if (lastUserIndex === undefined) {
		return [];
	}
	return messages.slice(lastUserIndex);
}
