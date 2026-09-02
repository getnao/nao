import {
	isToolUIPart as isToolUIPartAi,
	isStaticToolUIPart as isStaticToolUIPartAi,
	getStaticToolName as getStaticToolNameAi,
	getToolName as getToolNameAi,
} from 'ai';
import { isImageMediaType } from '@nao/shared/attachments';
import type { ReasoningUIPart, ToolUIPart } from 'ai';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { UITools, UIToolPart, UIMessage, UIMessagePart, StaticToolName } from '@nao/backend/chat';
import type { ImageUploadData } from '@nao/shared/attachments';
import type { ToolCallDensity } from '@nao/shared/types';
import type { GroupablePart, ToolGroupPart, GroupedMessagePart, MessageGroup } from '@/types/ai';
import type { DynamicToolName } from '@/components/tool-calls';

/** The ID used for new chats not yet persisted to the db. */
export const NEW_CHAT_ID = 'new-chat';

/** Check if a tool has reached its final state (no more actions needed). */
export const isToolSettled = ({ state }: UIToolPart) => {
	return state === 'output-available' || state === 'output-denied' || state === 'output-error';
};

/** Check if a message part is a tool part (static or dynamic). */
export const isToolUIPart = isToolUIPartAi<UITools>;

/** Check if a message part is a static tool part (tools with known types at compile time). */
export const isStaticToolUIPart = isStaticToolUIPartAi<UITools>;

/** Get the name of a static tool part. Returns a key of the UITools type. */
export const getStaticToolName = getStaticToolNameAi<UITools>;

/** Get the name of any tool part (static or dynamic). Returns a string. */
export const getToolName = getToolNameAi;

export const isToolInputStreaming = (part: ToolUIPart) => {
	return part.state === 'input-streaming';
};

/**
 * Check if the agent is actively generating content (streaming text or executing tools).
 * Returns true if any part is streaming or any tool is not yet settled.
 */
export const checkIsLastMessageStreaming = (messages: UIMessage[]) => {
	const lastMessage = messages.at(-1);
	if (!lastMessage) {
		return false;
	}
	return isMessageStreaming(lastMessage) || isSummarizing(lastMessage);
};

const isSummarizing = ({ parts }: UIMessage) => {
	return parts.at(-1)?.type === 'data-compactionSummaryStarted';
};

export const checkIsSomeToolsExecuting = (messages: UIMessage[]) => {
	const lastMessage = messages.at(-1);
	if (!lastMessage) {
		return false;
	}
	return lastMessage.parts.some((part) => isToolUIPart(part) && part.state === 'input-available');
};

export const isMessageStreaming = (message: UIMessage) => {
	return message.parts.some((part) => {
		if ('state' in part && (part.state === 'streaming' || part.state === 'input-streaming')) {
			return true;
		}
	});
};

export const checkIsAgentRunning = (agent: Pick<UseChatHelpers<UIMessage>, 'status'>) => {
	return agent.status === 'streaming' || agent.status === 'submitted';
};

/** Tools that should NOT be collapsed (important UI elements), per density setting. */
const NON_COLLAPSIBLE_TOOLS_BY_DENSITY: Record<ToolCallDensity, (StaticToolName | DynamicToolName)[]> = {
	compact: ['story', 'display_chart', 'display_map', 'suggest_follow_ups', 'clarification'],
	detailed: [
		'story',
		'execute_sql',
		'query_app_db',
		'record_recommendation',
		'display_chart',
		'display_map',
		'suggest_follow_ups',
		'clarification',
		'execute_python',
		'execute_sandboxed_code',
	],
};

/** Check if a part is a reasoning part */
export const isReasoningPart = (part: UIMessagePart): part is ReasoningUIPart => {
	return part.type === 'reasoning';
};

export const isToolGroupPart = (part: GroupedMessagePart): part is ToolGroupPart => {
	return part.type === 'tool-group';
};

export const areGroupedMessagePartsEqual = (left: GroupedMessagePart, right: GroupedMessagePart): boolean => {
	if (isToolGroupPart(left) || isToolGroupPart(right)) {
		return (
			isToolGroupPart(left) && isToolGroupPart(right) && areGroupedMessagePartArraysEqual(left.parts, right.parts)
		);
	}

	if (isToolUIPart(left) || isToolUIPart(right)) {
		return isToolUIPart(left) && isToolUIPart(right) && areToolPartsEqual(left, right);
	}

	if (left.type === 'text' && right.type === 'text') {
		const leftState = 'state' in left ? left.state : undefined;
		const rightState = 'state' in right ? right.state : undefined;
		return left.text === right.text && leftState === rightState;
	}

	if (left.type === 'reasoning' && right.type === 'reasoning') {
		const leftState = 'state' in left ? left.state : undefined;
		const rightState = 'state' in right ? right.state : undefined;
		return left.text === right.text && leftState === rightState;
	}

	return false;
};

export const areGroupedMessagePartArraysEqual = (left: GroupedMessagePart[], right: GroupedMessagePart[]): boolean => {
	return left.length === right.length && left.every((part, index) => areGroupedMessagePartsEqual(part, right[index]));
};

/**
 * Groups consecutive collapsible parts (tools and reasoning) into 'tool-group' parts.
 * Non-collapsible tools (depending on the density setting) and other message parts are returned as-is.
 */
export const groupToolCalls = (parts: UIMessagePart[], density: ToolCallDensity = 'detailed'): GroupedMessagePart[] => {
	const result: GroupedMessagePart[] = [];
	let currentGroup: GroupablePart[] = [];

	const flushGroup = () => {
		if (currentGroup.length > 0) {
			if (currentGroup.length === 1) {
				// Single item - don't group
				result.push(currentGroup[0]);
			} else {
				result.push({ type: 'tool-group', parts: [...currentGroup] });
			}
			currentGroup = [];
		}
	};

	for (const part of parts) {
		if (isPartGroupable(part, density)) {
			currentGroup.push(part);
		} else if (
			part.type === 'text' ||
			part.type === 'data-compaction' ||
			part.type === 'data-compactionSummaryStarted' ||
			isToolUIPart(part)
		) {
			flushGroup();
			result.push(part);
		}
	}

	flushGroup();
	return result;
};

/** Check if a message part should be collapsed (tool or reasoning) */
export const isPartGroupable = (part: UIMessagePart, density: ToolCallDensity = 'detailed'): part is GroupablePart => {
	if (isReasoningPart(part)) {
		return true;
	}
	if (isToolUIPart(part)) {
		const toolName = getToolName(part);
		const nonCollapsibleTools =
			NON_COLLAPSIBLE_TOOLS_BY_DENSITY[density] ?? NON_COLLAPSIBLE_TOOLS_BY_DENSITY.detailed;
		return !nonCollapsibleTools.includes(toolName as StaticToolName);
	}
	return false;
};

const areToolPartsEqual = (left: UIToolPart, right: UIToolPart): boolean => {
	const leftOutput = 'output' in left ? left.output : undefined;
	const rightOutput = 'output' in right ? right.output : undefined;
	const leftErrorText = 'errorText' in left ? left.errorText : undefined;
	const rightErrorText = 'errorText' in right ? right.errorText : undefined;
	const outputsAreEqual =
		isToolSettled(left) && isToolSettled(right)
			? getOutputRevision(left) === getOutputRevision(right)
			: leftOutput === rightOutput;

	return (
		left.type === right.type &&
		getToolName(left) === getToolName(right) &&
		left.toolCallId === right.toolCallId &&
		left.state === right.state &&
		areStructurallyEqual(left.input, right.input) &&
		outputsAreEqual &&
		leftErrorText === rightErrorText
	);
};

const getOutputRevision = (part: UIToolPart): unknown => {
	const output = 'output' in part ? part.output : undefined;
	return output && typeof output === 'object' && 'revision' in output ? output.revision : undefined;
};

export const areStructurallyEqual = (left: unknown, right: unknown): boolean => {
	return compareStructuralValues(left, right, new WeakMap());
};

const compareStructuralValues = (
	left: unknown,
	right: unknown,
	seenPairs: WeakMap<object, WeakSet<object>>,
): boolean => {
	if (Object.is(left, right)) {
		return true;
	}
	if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
		return false;
	}

	const leftIsArray = Array.isArray(left);
	const rightIsArray = Array.isArray(right);
	if (leftIsArray || rightIsArray) {
		if (!leftIsArray || !rightIsArray || left.length !== right.length) {
			return false;
		}
		if (hasSeenPair(left, right, seenPairs)) {
			return true;
		}
		return left.every((value, index) => compareStructuralValues(value, right[index], seenPairs));
	}

	if (!isPlainObject(left) || !isPlainObject(right)) {
		return false;
	}
	if (hasSeenPair(left, right, seenPairs)) {
		return true;
	}

	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	return (
		leftKeys.length === rightKeys.length &&
		leftKeys.every(
			(key) =>
				Object.prototype.hasOwnProperty.call(right, key) &&
				compareStructuralValues(left[key], right[key], seenPairs),
		)
	);
};

const hasSeenPair = (left: object, right: object, seenPairs: WeakMap<object, WeakSet<object>>): boolean => {
	const seenRights = seenPairs.get(left);
	if (seenRights?.has(right)) {
		return true;
	}
	if (seenRights) {
		seenRights.add(right);
	} else {
		seenPairs.set(left, new WeakSet([right]));
	}
	return false;
};

const isPlainObject = (value: object): value is Record<string, unknown> => {
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

export const getLastFollowUpSuggestionsToolCall = (
	messages: UIMessage[],
): UIToolPart<'suggest_follow_ups'> | undefined => {
	const followUpSuggestionsToolCallPart = messages.at(-1)?.parts.find((p) => p.type === 'tool-suggest_follow_ups');
	if (!followUpSuggestionsToolCallPart) {
		return undefined;
	}
	return followUpSuggestionsToolCallPart;
};

export const getMessageText = (message: UIMessage): string => {
	return message.parts
		.filter((part) => part.type === 'text')
		.map((part) => part.text)
		.join('\n');
};

export const getMessageImages = (message: UIMessage): { url: string; mediaType: string }[] => {
	return getFileParts(message)
		.filter((part) => part.mediaType.startsWith('image/'))
		.map((part) => ({ url: part.url, mediaType: part.mediaType }));
};

/** Attachments kept in permanent storage, whose URL is the path the agent reads them from. */
export const getMessageDocuments = (message: UIMessage): { path: string; mediaType: string; filename: string }[] => {
	return getFileParts(message)
		.filter((part) => !part.mediaType.startsWith('image/'))
		.map((part) => ({
			path: part.url,
			mediaType: part.mediaType,
			filename: part.filename ?? (part.url.split('/').pop() as string),
		}));
};

export const extractDocumentPathsFromMessage = (message: UIMessage): string[] => {
	return getMessageDocuments(message).map((document) => document.path);
};

const getFileParts = (message: UIMessage): Extract<UIMessagePart, { type: 'file' }>[] => {
	return message.parts.filter((part): part is Extract<UIMessagePart, { type: 'file' }> => part.type === 'file');
};

/** Extracts base64 image data from optimistic `data:` file parts for the upload payload. */
export const extractImagesFromMessage = (message: UIMessage): ImageUploadData[] => {
	return getFileParts(message)
		.filter((part) => part.mediaType.startsWith('image/') && part.url.startsWith('data:'))
		.flatMap((part) => {
			if (!isImageMediaType(part.mediaType)) {
				return [];
			}
			const commaIdx = part.url.indexOf(',');
			return [
				{
					mediaType: part.mediaType,
					data: commaIdx >= 0 ? part.url.slice(commaIdx + 1) : part.url,
				},
			];
		});
};

/**
 * Resolves image file parts into upload payloads. Handles optimistic `data:` URLs and
 * persisted `/i/{id}` URLs (fetched and re-encoded so edit/resend can reuse them).
 */
export const resolveImagesFromMessage = async (message: UIMessage): Promise<ImageUploadData[]> => {
	const imageParts = getFileParts(message).filter((part) => part.mediaType.startsWith('image/'));
	const images = await Promise.all(imageParts.map(imageUploadDataFromFilePart));
	return images.filter((image): image is ImageUploadData => image !== null);
};

async function imageUploadDataFromFilePart(
	part: Extract<UIMessagePart, { type: 'file' }>,
): Promise<ImageUploadData | null> {
	if (part.url.startsWith('data:')) {
		if (!isImageMediaType(part.mediaType)) {
			return null;
		}
		const commaIdx = part.url.indexOf(',');
		return {
			mediaType: part.mediaType,
			data: commaIdx >= 0 ? part.url.slice(commaIdx + 1) : part.url,
		};
	}

	const response = await fetch(part.url);
	if (!response.ok) {
		throw new Error(`Failed to load attached image (${response.status})`);
	}
	const blob = await response.blob();
	const mediaType = isImageMediaType(part.mediaType)
		? part.mediaType
		: isImageMediaType(blob.type)
			? blob.type
			: null;
	if (!mediaType) {
		return null;
	}
	return { mediaType, data: await blobToBase64(blob) };
}

function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => {
			const dataUrl = reader.result as string;
			resolve(dataUrl.split(',')[1] ?? '');
		};
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}

/** Group messages into user and response (assistant) messages. */
export const groupMessages = (messages: UIMessage[]): MessageGroup[] => {
	const groups: MessageGroup[] = [];
	for (let i = 0; i < messages.length; ) {
		const msg = messages[i++];
		if (msg.role !== 'user') {
			const lastGroup = groups.at(-1);
			if (lastGroup) {
				lastGroup.assistantMessages.push(msg);
			} else {
				groups.push({ userMessage: null, assistantMessages: [msg] });
			}
			continue;
		}
		const group: MessageGroup = { userMessage: msg, assistantMessages: [] };
		while (i < messages.length && messages[i].role === 'assistant') {
			group.assistantMessages.push(messages[i]);
			i++;
		}
		groups.push(group);
	}
	return groups;
};

export const getLastAssistantMessageId = (messages: UIMessage[]): string | undefined => {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'assistant') {
			return messages[i].id;
		}
	}
	return undefined;
};

export const getLastUserMessageIdx = (messages: UIMessage[]): number | undefined => {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'user') {
			return i;
		}
	}
	return undefined;
};

export const getTextFromUserMessageOrThrow = (message: UIMessage): string => {
	if (message.role !== 'user') {
		throw new Error('Message is not a user message.');
	}
	const textPart = message.parts.find((part) => part.type === 'text');
	if (!textPart) {
		return '';
	}
	return textPart.text;
};

export const checkAssistantMessageHasContent = (message: UIMessage): boolean => {
	return message.parts.some(
		(part) =>
			part.type !== 'step-start' &&
			part.type !== 'tool-suggest_follow_ups' &&
			part.type !== 'reasoning' &&
			part.type !== 'data-newChat' &&
			part.type !== 'data-newUserMessage',
	);
};

export function parseBudgetError(error: Error | undefined): string | null {
	if (!error) {
		return null;
	}
	try {
		const parsed = JSON.parse(error.message);
		return parsed.code === 'BUDGET_EXCEEDED' ? (parsed.error ?? parsed.message ?? error.message) : null;
	} catch {
		return null;
	}
}
