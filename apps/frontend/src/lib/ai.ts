import {
	isToolUIPart as isToolUIPartAi,
	isStaticToolUIPart as isStaticToolUIPartAi,
	getStaticToolName as getStaticToolNameAi,
	getToolName as getToolNameAi,
} from 'ai';
import type { ReasoningUIPart } from 'ai';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { UITools, UIToolPart, UIMessage, UIMessagePart, StaticToolName } from '@nao/backend/chat';
import type { CollapsiblePart, ToolGroupPart, GroupedMessagePart } from '@/types/ai';

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
export const checkIsAgentGenerating = (agent: Pick<UseChatHelpers<UIMessage>, 'status' | 'messages'>) => {
	const isRunning = checkIsAgentRunning(agent);
	if (!isRunning) {
		return false;
	}

	const lastMessage = agent.messages.at(-1);
	if (!lastMessage) {
		return false;
	}

	return isMessageSettled(lastMessage);
};

export const isMessageSettled = (message: UIMessage) => {
	return message.parts.some((part) => {
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

export const checkIsAgentRunning = (agent: Pick<UseChatHelpers<UIMessage>, 'status'>) => {
	return agent.status === 'streaming' || agent.status === 'submitted';
};

/** Tools that should NOT be collapsed (important UI elements) */
export const NON_COLLAPSIBLE_TOOLS: StaticToolName[] = ['execute_sql', 'display_chart', 'suggest_follow_ups'];

/** Check if a part is a reasoning part */
export const isReasoningPart = (part: UIMessagePart): part is ReasoningUIPart => {
	return part.type === 'reasoning';
};

export const isToolGroupPart = (part: GroupedMessagePart): part is ToolGroupPart => {
	return part.type === 'tool-group';
};

/**
 * Groups consecutive collapsible parts (tools and reasoning) into 'tool-group' parts.
 * Non-collapsible tools (execute_sql, display_chart) and other message parts are returned as-is.
 */
export const groupToolCalls = (parts: UIMessagePart[]): GroupedMessagePart[] => {
	const result: GroupedMessagePart[] = [];
	let currentGroup: CollapsiblePart[] = [];

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
		if (isCollapsiblePart(part)) {
			currentGroup.push(part);
		} else if (part.type === 'text' || isToolUIPart(part)) {
			flushGroup();
			result.push(part);
		}
	}

	flushGroup();
	return result;
};

/** Check if a message part should be collapsed (tool or reasoning) */
export const isCollapsiblePart = (part: UIMessagePart): part is CollapsiblePart => {
	if (isReasoningPart(part)) {
		return true;
	}
	if (isToolUIPart(part)) {
		const toolName = getToolName(part);
		return !(NON_COLLAPSIBLE_TOOLS as readonly string[]).includes(toolName);
	}
	return false;
};

export const getLastFollowUpSuggestions = (messages: UIMessage[]): { suggestions: string[]; isLoading: boolean } => {
	const followUpSuggestionsToolCallPart = messages.at(-1)?.parts.find((p) => p.type === 'tool-suggest_follow_ups');
	if (!followUpSuggestionsToolCallPart || followUpSuggestionsToolCallPart.state === 'input-streaming') {
		return { suggestions: [], isLoading: false };
	}

	return {
		suggestions: followUpSuggestionsToolCallPart.input?.suggestions ?? [],
		isLoading: !isToolSettled(followUpSuggestionsToolCallPart),
	};
};
