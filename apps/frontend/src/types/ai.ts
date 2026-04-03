import type { ReasoningUIPart } from 'ai';
import type { UIToolPart, UIMessagePart, UIMessage } from '@nao/backend/chat';

/** A collapsible part can be either a tool or reasoning */
export type GroupablePart = UIToolPart | ReasoningUIPart;

/** A grouped set of consecutive collapsible parts (tools and reasoning) */
export type ToolGroupPart = { type: 'tool-group'; parts: GroupablePart[] };

/** Union of regular message parts and tool groups */
export type GroupedMessagePart = UIMessagePart | ToolGroupPart;

/** A group of user and assistant messages. */
export interface MessageGroup {
	userMessage: UIMessage | null;
	assistantMessages: UIMessage[];
}
