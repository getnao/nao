import {
	isToolUIPart as isToolUIPartAi,
	isStaticToolUIPart as isStaticToolUIPartAi,
	getStaticToolName as getStaticToolNameAi,
	getToolName as getToolNameAi,
} from 'ai';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { UITools, ToolUIPart, Message } from 'backend/chat';

/** Check if a tool has reached its final state (no more actions needed). */
export const isToolSettled = ({ state }: ToolUIPart) => {
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

export const checkIsGenerating = (
	status: UseChatHelpers<Message>['status'],
	messages: UseChatHelpers<Message>['messages'],
) => {
	const isRunning = checkIsRunning(status);
	if (!isRunning) {
		return false;
	}

	const lastMessage = messages.at(-1);
	if (!lastMessage) {
		return false;
	}

	return lastMessage.parts.some((part) => part.type === 'step-start');
};

export const checkIsRunning = (status: UseChatHelpers<Message>['status']) => {
	return status === 'streaming' || status === 'submitted';
};
