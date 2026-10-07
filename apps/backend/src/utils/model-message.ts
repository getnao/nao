import { createHash } from 'node:crypto';

import type { ModelMessage } from 'ai';

const PROVIDER_SAFE_PATTERN = /^[a-zA-Z0-9_-]+$/;
const TOOL_CALL_ID_MAX_LENGTH = 64;
const TOOL_CALL_ID_HASH_LENGTH = 8;
const TOOL_NAME_MAX_LENGTH = 64;
const TOOL_NAME_HASH_LENGTH = 8;

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
	if (PROVIDER_SAFE_PATTERN.test(toolCallId) && toolCallId.length <= TOOL_CALL_ID_MAX_LENGTH) {
		return toolCallId;
	}
	const hash = createHash('sha1').update(toolCallId).digest('hex').slice(0, TOOL_CALL_ID_HASH_LENGTH);
	const cleaned = toolCallId
		.replace(/[^a-zA-Z0-9_-]/g, '_')
		.slice(0, TOOL_CALL_ID_MAX_LENGTH - TOOL_CALL_ID_HASH_LENGTH - 1);
	return `${cleaned}_${hash}`;
}

/**
 * Rewrites tool names so they satisfy OpenAI's and Anthropic's `^[a-zA-Z0-9_-]+$` and 64-char
 * limit. MCP tools can carry server-prefixed names like `my.server__list-dashboards` whose dots
 * (or other non-matching chars from a server-chosen alias) break the request. The mapping is
 * deterministic so a tool-call part and its matching tool-result part always resolve to the same
 * sanitized name.
 */
export function sanitizeToolNames(messages: ModelMessage[]): ModelMessage[] {
	return messages.map((message) => {
		if (!Array.isArray(message.content)) {
			return message;
		}
		const content = message.content.map((part) => {
			if (!('toolName' in part) || typeof part.toolName !== 'string') {
				return part;
			}
			return { ...part, toolName: toProviderSafeToolName(part.toolName) };
		});
		return { ...message, content } as ModelMessage;
	});
}

/**
 * Rewrites the KEYS of a tools map with `toProviderSafeToolName` so the names offered to the
 * provider match the sanitized names in the replayed history. The values (tool definitions) are
 * untouched, so a sanitized key still resolves to the right execute handler at tool-call time.
 *
 * Call this everywhere the tools map is handed to the provider or to code that compares against
 * tool-call names (ToolLoopAgent, compactionService, telemetry), so replayed history and offered
 * tools stay consistent.
 *
 * Uses a null-prototype map so a tool literally named ``__proto__`` becomes an own property
 * instead of silently mutating the object prototype. Throws when two originals sanitize to the
 * same key: both would otherwise overwrite each other, and a replayed call for one could then
 * silently execute the other's handler.
 */
export function sanitizeToolDefinitionNames<T>(tools: Record<string, T>): Record<string, T> {
	const safe: Record<string, T> = Object.create(null);
	const originalByKey = new Map<string, string>();
	for (const [name, definition] of Object.entries(tools)) {
		const safeName = toProviderSafeToolName(name);
		const existingOriginal = originalByKey.get(safeName);
		if (existingOriginal !== undefined && existingOriginal !== name) {
			throw new Error(
				`Tool name collision after sanitization: "${existingOriginal}" and "${name}" both resolve to "${safeName}". Rename one of them.`,
			);
		}
		originalByKey.set(safeName, name);
		safe[safeName] = definition;
	}
	return safe;
}

export function toProviderSafeToolName(toolName: string): string {
	if (PROVIDER_SAFE_PATTERN.test(toolName) && toolName.length <= TOOL_NAME_MAX_LENGTH) {
		return toolName;
	}
	const hash = createHash('sha1').update(toolName).digest('hex').slice(0, TOOL_NAME_HASH_LENGTH);
	const cleaned = toolName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, TOOL_NAME_MAX_LENGTH - TOOL_NAME_HASH_LENGTH - 1);
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
