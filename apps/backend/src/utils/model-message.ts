import type { ModelMessage } from 'ai';

/**
 * Replaces image/file parts in model messages with text placeholders.
 * Used by compaction to avoid sending binary data to the summarization LLM.
 */
export function stripImageParts(messages: ModelMessage[]): ModelMessage[] {
	return messages.map((message) => {
		if (!Array.isArray(message.content)) {
			return message;
		}

		const parts = message.content as Record<string, unknown>[];
		const hasImage = parts.some((part) => part.type === 'file' || part.type === 'image');
		if (!hasImage) {
			return message;
		}

		const strippedContent = parts.map((part) => {
			if (part.type === 'file' || part.type === 'image') {
				return { type: 'text' as const, text: '[Image]' };
			}
			return part;
		});

		return { ...message, content: strippedContent } as ModelMessage;
	});
}
