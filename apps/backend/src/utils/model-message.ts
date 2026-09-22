import { createHash } from 'node:crypto';

import type { ModelMessage } from 'ai';

const TOOL_CALL_ID_MAX_LENGTH = 64;
const TOOL_CALL_ID_SAFE_PATTERN = /^[a-zA-Z0-9_-]+$/;
const TOOL_CALL_ID_HASH_LENGTH = 8;

/**
 * Rewrites tool call ids so they satisfy the strictest provider constraints (Anthropic's `^[a-zA-Z0-9_-]+$`,
 * OpenAI's 64-char limit). Stored ids can violate them when a chat was started on a provider with request-scoped
 * ids like `functions.execute_sql:0` and later namespaced with the message id to keep them unique.
 */
export function sanitizeToolCallIds(messages: ModelMessage[]): ModelMessage[] {
	return messages.map((message) => {
		if (!Array.isArray(message.content)) {
			return message;
		}
		const content = message.content.map((part) => {
			if (!('toolCallId' in part) || typeof part.toolCallId !== 'string') {
				return part;
			}
			return { ...part, toolCallId: toProviderSafeToolCallId(part.toolCallId) };
		});
		return { ...message, content } as ModelMessage;
	});
}

export function toProviderSafeToolCallId(toolCallId: string): string {
	if (TOOL_CALL_ID_SAFE_PATTERN.test(toolCallId) && toolCallId.length <= TOOL_CALL_ID_MAX_LENGTH) {
		return toolCallId;
	}
	const hash = createHash('sha1').update(toolCallId).digest('hex').slice(0, TOOL_CALL_ID_HASH_LENGTH);
	const cleaned = toolCallId
		.replace(/[^a-zA-Z0-9_-]/g, '_')
		.slice(0, TOOL_CALL_ID_MAX_LENGTH - TOOL_CALL_ID_HASH_LENGTH - 1);
	return `${cleaned}_${hash}`;
}

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
