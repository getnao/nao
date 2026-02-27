import { generateText, ModelMessage } from 'ai';

import { COMPACTION_SYSTEM_PROMPT } from '../../components/ai/compaction-system-prompt';
import { COMPACTION_USER_PROMPT } from '../../components/ai/compaction-user-prompt';
import { TokenUsage } from '../../types/chat';
import { convertToTokenUsage, estimateMessageTokens, estimateTokens } from '../../utils/ai';
import { debugCompaction } from '../../utils/debug';
import { type ProviderModelResult } from '../providers';

interface CompactionResult {
	summary: string;
	usage: TokenUsage;
}

const COMPACTION_CONTEXT_WINDOW = 200_000;
const MAX_OUTPUT_TOKENS = 8_000;

export class CompactionLLM {
	constructor(private readonly model: ProviderModelResult) {}

	async compact(messages: ModelMessage[]): Promise<CompactionResult> {
		const modelMessages = this._buildModelMessages(messages);

		debugCompaction('Compaction LLM', { modelMessages });

		const { text, usage } = await generateText({
			...this.model,
			messages: modelMessages,
			maxOutputTokens: MAX_OUTPUT_TOKENS,
		});

		return { summary: text, usage: convertToTokenUsage(usage) };
	}

	private _buildModelMessages(messages: ModelMessage[]): ModelMessage[] {
		const inputBudget = this._getInputBudget();
		const selectedMessages = this._selectRecentMessages(messages, inputBudget);
		const modelMessages = this._composeMessages(selectedMessages);

		debugCompaction('message selection', {
			totalMessages: messages.length,
			selectedMessages: selectedMessages.length,
			droppedMessages: messages.length - selectedMessages.length,
			inputBudget,
		});

		return modelMessages;
	}

	private _getInputBudget(): number {
		const prefixAndSuffixMessages: ModelMessage[] = [
			{ role: 'system', content: COMPACTION_SYSTEM_PROMPT },
			{ role: 'user', content: COMPACTION_USER_PROMPT },
		];
		const prefixAndSuffixTokens = estimateTokens(JSON.stringify(prefixAndSuffixMessages));
		return COMPACTION_CONTEXT_WINDOW - MAX_OUTPUT_TOKENS - prefixAndSuffixTokens;
	}

	private _selectRecentMessages(messages: ModelMessage[], inputBudget: number): ModelMessage[] {
		const selectedMessages: ModelMessage[] = [];
		let tokenCount = 0;

		// Keep a contiguous suffix: add as many recent messages as possible.
		for (let i = messages.length - 1; i >= 0; i--) {
			const messageTokens = estimateMessageTokens(messages[i]);
			if (tokenCount + messageTokens > inputBudget) {
				break;
			}
			selectedMessages.unshift(messages[i]);
			tokenCount += messageTokens;
		}

		return selectedMessages;
	}

	private _composeMessages(selectedMessages: ModelMessage[]): ModelMessage[] {
		return [
			{ role: 'system', content: COMPACTION_SYSTEM_PROMPT },
			...selectedMessages,
			{ role: 'user', content: COMPACTION_USER_PROMPT },
		];
	}
}
