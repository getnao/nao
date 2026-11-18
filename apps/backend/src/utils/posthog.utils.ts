import { getToolName, isToolUIPart } from 'ai';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

import type { UIMessage } from '../types/chat';
import { getErrorMessage, truncateMiddle } from './utils';

const TRACKED_ERROR_MAX_LENGTH = 500;

type ToolPart = Extract<UIMessage['parts'][number], { toolCallId: string }>;

/** Summarises the tool calls and the errors of an assistant message for the `message_sent` event. */
export const getAssistantMessageTrackingProperties = (message: UIMessage, streamError: unknown) => {
	const toolParts = message.parts.filter(isToolUIPart);
	const toolErrors = toolParts.flatMap(toTrackedToolError);
	const streamErrorMessage = getErrorMessage(streamError);

	return {
		tool_call_count: toolParts.length,
		tool_calls_by_type: countToolCallsByType(toolParts),
		tool_error_count: toolErrors.length,
		tool_errors: toolErrors,
		error: streamErrorMessage ? truncateMiddle(streamErrorMessage, TRACKED_ERROR_MAX_LENGTH) : null,
		has_error: !!streamErrorMessage || toolErrors.length > 0,
	};
};

const countToolCallsByType = (toolParts: ToolPart[]): Record<string, number> => {
	const counts: Record<string, number> = {};
	for (const part of toolParts) {
		const toolName = getToolName(part);
		counts[toolName] = (counts[toolName] ?? 0) + 1;
	}
	return counts;
};

const toTrackedToolError = (part: ToolPart): { tool_name: string; error: string }[] => {
	if (part.state !== 'output-error') {
		return [];
	}
	return [{ tool_name: getToolName(part), error: truncateMiddle(part.errorText, TRACKED_ERROR_MAX_LENGTH) }];
};

/**
 * Get or create a persistent anonymous distinct ID for this user.
 * The ID is stored in ~/.nao/distinct_id to persist across invocations.
 */
export const getPostHogDistinctId = (): string => {
	try {
		const existingId = getPostHogIdFromFile();
		if (existingId) {
			return existingId;
		}

		// Create new ID and persist it
		const newId = randomUUID();
		persistPostHogId(newId);
		return newId;
	} catch {
		// If we can't persist, generate a new ID each time
		return randomUUID();
	}
};

const getPostHogIdFromFile = () => {
	const filePath = getDistinctIdFilePath();
	if (!existsSync(filePath)) {
		return undefined;
	}
	const existingId = readFileSync(filePath, 'utf-8').trim().split('\n')[0];
	if (!isValidUuid(existingId)) {
		return undefined;
	}
	return existingId;
};

const getDistinctIdFilePath = () => join(homedir(), '.nao', 'distinct_id');

const isValidUuid = (id: string): boolean => {
	return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
};

export const persistPostHogId = (id: string) => {
	const filePath = getDistinctIdFilePath();
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, id, 'utf-8');
};
