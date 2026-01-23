import {
	isToolUIPart as isToolUIPartAi,
	isStaticToolUIPart as isStaticToolUIPartAi,
	getStaticToolName as getStaticToolNameAi,
	getToolName as getToolNameAi,
} from 'ai';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { UITools, UIToolPart, UIMessage } from 'backend/chat';

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

/**
 * Check if the agent is actively generating content (streaming text or executing tools).
 * Returns true if any part is streaming or any tool is not yet settled.
 */
export const checkIsAgentGenerating = (
	status: UseChatHelpers<UIMessage>['status'],
	messages: UseChatHelpers<UIMessage>['messages'],
) => {
	const isRunning = checkIsAgentRunning(status);
	if (!isRunning) {
		return false;
	}

	const lastMessage = messages.at(-1);
	if (!lastMessage) {
		return false;
	}

	return lastMessage.parts.some((part) => {
		// Check for streaming text/reasoning
		if ('state' in part && part.state === 'streaming') {
			return true;
		}
		// Check for tools that are pending or executing (not settled)
		if (isToolUIPart(part)) {
			return !isToolSettled(part);
		}
		return false;
	});
};

export const checkIsAgentRunning = (status: UseChatHelpers<UIMessage>['status']) => {
	return status === 'streaming' || status === 'submitted';
};
