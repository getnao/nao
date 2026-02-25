import { generateText, LanguageModelUsage, ModelMessage, Output } from 'ai';
import { inspect } from 'util';

import { renderMemoryExtractionUserMessage } from '../../components/ai';
import { MEMORY_EXTRACTION_SYSTEM_PROMPT } from '../../components/ai/memory-system-prompt';
import { DBMemory } from '../../db/abstractSchema';
import { UIMessage } from '../../types/chat';
import { extractAllTextParts, getLastUserMessageText } from '../../utils/ai';
import { type ProviderModelResult } from '../providers';
import type { ExtractorLLMOutput } from './output-schema';
import { ExtractorOutputSchema } from './output-schema';

interface MemoryExtractorResult {
	output: ExtractorLLMOutput;
	usage: LanguageModelUsage;
}

const DEBUG = false;

const CONVERSATION_MESSAGE_LIMIT = 17;
const MESSAGE_CHAR_LIMIT = 1250;
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

		this._printDebug('--- modelMessages ---', modelMessages);

		const { output, usage } = await generateText({
			...this.model,
			output: Output.object({ schema: ExtractorOutputSchema }),
			messages: modelMessages,
			maxOutputTokens: 4000,
		});

		this._printDebug('--- output ---', output);

		return { output, usage };
	}

	private _buildModelMessages(memories: DBMemory[], uiMessages: UIMessage[]): ModelMessage[] {
		const conversationMessages = this._buildConversationMessages(uiMessages);
		return [
			{ role: 'system', content: MEMORY_EXTRACTION_SYSTEM_PROMPT },
			...conversationMessages,
			this._buildUserMemoryMessage(memories),
		];
	}

	private _buildConversationMessages(uiMessages: UIMessage[]): ModelMessage[] {
		const recent = uiMessages.slice(-CONVERSATION_MESSAGE_LIMIT);
		const modelMessages: ModelMessage[] = [];

		for (const message of recent) {
			if (message.role !== 'user' && message.role !== 'assistant') {
				continue;
			}
			const text = extractAllTextParts(message).slice(0, MESSAGE_CHAR_LIMIT);
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

	private _printDebug(message: string, data: unknown): void {
		if (DEBUG) {
			console.log(message, inspect(data, { showHidden: false, depth: null, colors: true }), message);
		}
	}
}
