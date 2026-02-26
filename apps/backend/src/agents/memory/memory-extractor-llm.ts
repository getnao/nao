import { generateText, ModelMessage, Output } from 'ai';

import { renderMemoryExtractionUserMessage } from '../../components/ai';
import { MEMORY_EXTRACTION_SYSTEM_PROMPT } from '../../components/ai/memory-system-prompt';
import { DBMemory } from '../../db/abstractSchema';
import { TokenUsage, UIMessage } from '../../types/chat';
import type { ExtractorLLMOutput } from '../../types/memory';
import { ExtractorOutputSchema } from '../../types/memory';
import { convertToTokenUsage, findLastUserMessage, getLastUserMessageText, joinAllTextParts } from '../../utils/ai';
import { debugMemory } from '../../utils/debug';
import { truncateMiddle } from '../../utils/utils';
import { type ProviderModelResult } from '../providers';

interface MemoryExtractorResult {
	output: ExtractorLLMOutput;
	usage: TokenUsage;
}

const CONVERSATION_MESSAGE_LIMIT = 17;
const MESSAGE_CHAR_LIMIT = 1_250;
const LAST_USER_MESSAGE_CHAR_LIMIT = 2_000;
const MIN_USER_TEXT_LENGTH = 3;

/**
 * Sends existing memories and recent conversation to an LLM and returns new memories to be persisted.
 */
export class MemoryExtractorLLM {
	constructor(private readonly model: ProviderModelResult) {}

	async extract(memories: DBMemory[], uiMessages: UIMessage[]): Promise<MemoryExtractorResult | undefined> {
		const lastUserText = getLastUserMessageText(uiMessages);
		if (!uiMessages.length || lastUserText.length < MIN_USER_TEXT_LENGTH) {
			return undefined;
		}

		const modelMessages = this._buildModelMessages(memories, uiMessages);

		debugMemory('modelMessages', modelMessages);

		const { output, usage } = await generateText({
			...this.model,
			output: Output.object({ schema: ExtractorOutputSchema }),
			messages: modelMessages,
			maxOutputTokens: 4000,
		});

		debugMemory('output', output);

		return { output, usage: convertToTokenUsage(usage) };
	}

	private _buildModelMessages(memories: DBMemory[], uiMessages: UIMessage[]): ModelMessage[] {
		return [
			{ role: 'system', content: MEMORY_EXTRACTION_SYSTEM_PROMPT },
			...this._buildConversationMessages(uiMessages),
			this._buildUserMemoryMessage(memories),
		];
	}

	private _buildConversationMessages(uiMessages: UIMessage[]): ModelMessage[] {
		const recent = uiMessages.slice(-CONVERSATION_MESSAGE_LIMIT);
		const modelMessages: ModelMessage[] = [];
		const [lastUserMessage] = findLastUserMessage(recent);

		for (const message of recent) {
			if (message.role !== 'user' && message.role !== 'assistant') {
				continue;
			}
			const isLastUserMessage = message === lastUserMessage;
			const maxLength = isLastUserMessage ? LAST_USER_MESSAGE_CHAR_LIMIT : MESSAGE_CHAR_LIMIT;
			const text = truncateMiddle(joinAllTextParts(message), maxLength);
			if (!text) {
				continue;
			}
			modelMessages.push({ role: message.role, content: text });
		}

		return modelMessages;
	}

	private _buildUserMemoryMessage(memories: DBMemory[]): ModelMessage {
		return { role: 'user', content: renderMemoryExtractionUserMessage(memories) };
	}
}
