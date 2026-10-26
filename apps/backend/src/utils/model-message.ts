import { createHash } from 'node:crypto';

import { type LlmProvider, providerKind } from '@nao/shared/types';
import type { ModelMessage } from 'ai';

import { ADVISOR_TOOL_NAME } from '../agents/tools/advisor';

const PROVIDER_SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9_-]+$/;
const IDENTIFIER_HASH_LENGTH = 8;
const TOOL_CALL_ID_MAX_LENGTH = 64;
const TOOL_NAME_MAX_LENGTH = 64;
const THOUGHT_SIGNATURE_SEPARATOR = '__thought__';

/**
 * Rewrites tool call ids and names so they satisfy the strictest provider constraints (Anthropic's
 * `^[a-zA-Z0-9_-]+$`, OpenAI's 64-char limit). Stored values can violate them when replaying chats
 * created by another provider or the legacy direct MCP integration.
 *
 * LiteLLM carries Gemini thought signatures inside the id (`call_x__thought__<base64>`) and decodes them back on
 * the next request, so the signature is kept verbatim for OpenAI-compatible providers and dropped for the others.
 */
export function sanitizeToolCalls(messages: ModelMessage[], provider: LlmProvider): ModelMessage[] {
	return messages.map((message) => {
		if (!Array.isArray(message.content)) {
			return message;
		}
		const content = message.content.map((part) => {
			const hasToolCallId = 'toolCallId' in part && typeof part.toolCallId === 'string';
			const hasToolName = 'toolName' in part && typeof part.toolName === 'string';
			if (!hasToolCallId && !hasToolName) {
				return part;
			}
			return {
				...part,
				...(hasToolCallId && { toolCallId: toProviderSafeToolCallId(part.toolCallId, provider) }),
				...(hasToolName && { toolName: toSafeIdentifier(part.toolName, TOOL_NAME_MAX_LENGTH) }),
			};
		});
		return { ...message, content } as ModelMessage;
	});
}

export function toProviderSafeToolCallId(toolCallId: string, provider: LlmProvider): string {
	const [baseId, thoughtSignature] = splitThoughtSignature(toolCallId);
	const safeBaseId = toSafeToolCallId(baseId);
	if (!thoughtSignature || !keepsThoughtSignature(provider)) {
		return safeBaseId;
	}
	return `${safeBaseId}${THOUGHT_SIGNATURE_SEPARATOR}${thoughtSignature}`;
}

function splitThoughtSignature(toolCallId: string): [string, string | undefined] {
	const separatorIndex = toolCallId.indexOf(THOUGHT_SIGNATURE_SEPARATOR);
	if (separatorIndex === -1) {
		return [toolCallId, undefined];
	}
	return [toolCallId.slice(0, separatorIndex), toolCallId.slice(separatorIndex + THOUGHT_SIGNATURE_SEPARATOR.length)];
}

function keepsThoughtSignature(provider: LlmProvider): boolean {
	return providerKind(provider) === 'openaiCompatible';
}

function toSafeToolCallId(toolCallId: string): string {
	return toSafeIdentifier(toolCallId, TOOL_CALL_ID_MAX_LENGTH);
}

function toSafeIdentifier(value: string, maxLength: number): string {
	if (PROVIDER_SAFE_IDENTIFIER_PATTERN.test(value) && value.length <= maxLength) {
		return value;
	}
	const hash = createHash('sha1').update(value).digest('hex').slice(0, IDENTIFIER_HASH_LENGTH);
	const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, maxLength - IDENTIFIER_HASH_LENGTH - 1);
	return `${cleaned}_${hash}`;
}

/**
 * Drops reasoning parts from assistant messages so a thinking-disabled summarization call does
 * not fail with Anthropic's "`thinking` or `redacted_thinking` blocks in the latest assistant
 * message cannot be modified" error. Compaction wraps the model with reasoning disabled, so any
 * reasoning part replayed from the stored history would violate that rule. A thinking-only
 * assistant turn is replaced with a short placeholder so the message stays non-empty and still
 * carries conversational position.
 */
export function stripReasoningParts(messages: ModelMessage[]): ModelMessage[] {
	return messages.map((message) => {
		if (message.role !== 'assistant' || !Array.isArray(message.content)) {
			return message;
		}
		const parts = message.content as { type: string }[];
		const kept = parts.filter((part) => part.type !== 'reasoning');
		if (kept.length === parts.length && parts.length > 0) {
			return message;
		}
		const content = kept.length > 0 ? kept : [{ type: 'text' as const, text: '[Reasoning omitted]' }];
		return { ...message, content } as ModelMessage;
	});
}

/**
 * Anthropic rejects a history holding advisor blocks when the advisor tool is not offered, and only a
 * successful advisor result can be replayed: failed or interrupted calls carry an error the SDK cannot
 * convert back. Advisor calls are dropped from the history, except the successful ones while the
 * advisor is still offered. An assistant turn left empty is dropped as well.
 */
export function stripAdvisorParts(messages: ModelMessage[], advisorOffered: boolean): ModelMessage[] {
	const replayableCallIds = advisorOffered ? collectReplayableAdvisorCallIds(messages) : new Set<string>();
	return messages.flatMap((message) => {
		if (message.role !== 'assistant' || !Array.isArray(message.content)) {
			return [message];
		}
		const content = message.content.filter(
			(part) => !isAdvisorPart(part) || replayableCallIds.has(part.toolCallId),
		);
		if (content.length === message.content.length) {
			return [message];
		}
		return content.length > 0 ? [{ ...message, content }] : [];
	});
}

function collectReplayableAdvisorCallIds(messages: ModelMessage[]): Set<string> {
	const callIds = new Set<string>();
	for (const message of messages) {
		if (message.role !== 'assistant' || !Array.isArray(message.content)) {
			continue;
		}
		for (const part of message.content) {
			if (isAdvisorPart(part) && part.type === 'tool-result' && part.output.type === 'json') {
				callIds.add(part.toolCallId);
			}
		}
	}
	return callIds;
}

type AssistantContentPart = Exclude<Extract<ModelMessage, { role: 'assistant' }>['content'], string>[number];
type AdvisorPart = Extract<AssistantContentPart, { type: 'tool-call' | 'tool-result' }>;

function isAdvisorPart(part: AssistantContentPart): part is AdvisorPart {
	return (part.type === 'tool-call' || part.type === 'tool-result') && part.toolName === ADVISOR_TOOL_NAME;
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
