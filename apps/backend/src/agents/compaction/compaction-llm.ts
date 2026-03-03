import { generateText, ModelMessage } from 'ai';

import { COMPACTION_SYSTEM_PROMPT } from '../../components/ai/compaction-system-prompt';
import { COMPACTION_USER_PROMPT } from '../../components/ai/compaction-user-prompt';
import { ITokenCounter } from '../../services/token-counter';
import { CompactionResult, ICompactionLLM } from '../../types/compaction';
import { convertToTokenUsage, selectMessagesInBudget } from '../../utils/ai';
import { debugCompaction } from '../../utils/debug';
import { type ProviderModelResult } from '../providers';

const MAX_OUTPUT_TOKENS = 16_000;

export class CompactionLLM implements ICompactionLLM {
	readonly modelId: string;

	constructor(
		private readonly _model: ProviderModelResult,
		private readonly _tc: ITokenCounter,
	) {
		this.modelId = _model.model.modelId;
	}

	async compact(messages: ModelMessage[]): Promise<CompactionResult> {
		const modelMessages = this._buildModelMessages(messages);

		debugCompaction('Compaction LLM', { modelMessages });

		const { text, usage } = await generateText({
			...this._model,
			messages: modelMessages,
			maxOutputTokens: MAX_OUTPUT_TOKENS,
		});

		return { summary: text, usage: convertToTokenUsage(usage) };
	}

	private _buildModelMessages(messages: ModelMessage[]): ModelMessage[] {
		const budget = this._getTokenBudget();
		const selectedMessages = selectMessagesInBudget(messages, budget, this._tc);
		const modelMessages = this._composeMessages(selectedMessages);

		debugCompaction('message selection', {
			totalMessages: messages.length,
			selectedMessages: selectedMessages.length,
			droppedMessages: messages.length - selectedMessages.length,
			budget,
		});

		return modelMessages;
	}

	private _getTokenBudget(): number {
		const prefixAndSuffixMessages: ModelMessage[] = [
			{ role: 'system', content: COMPACTION_SYSTEM_PROMPT },
			{ role: 'user', content: COMPACTION_USER_PROMPT },
		];
		const prefixAndSuffixTokens = this._tc.estimateMessages(prefixAndSuffixMessages);
		return this._model.contextWindow - MAX_OUTPUT_TOKENS - prefixAndSuffixTokens;
	}

	private _composeMessages(selectedMessages: ModelMessage[]): ModelMessage[] {
		return [
			{ role: 'system', content: COMPACTION_SYSTEM_PROMPT },
			...selectedMessages,
			{ role: 'user', content: COMPACTION_USER_PROMPT },
		];
	}
}
