import type { ReasoningUIPart } from 'ai';
import type { UIToolPart, UIMessagePart, UIMessage } from '@nao/backend/chat';
import type { LlmProvider } from '@nao/backend/llm';

/** A collapsible part can be either a tool or reasoning */
export type CollapsiblePart = UIToolPart | ReasoningUIPart;

/** A grouped set of consecutive collapsible parts (tools and reasoning) */
export type ToolGroupPart = { type: 'tool-group'; parts: CollapsiblePart[] };

/** Union of regular message parts and tool groups */
export type GroupedMessagePart = UIMessagePart | ToolGroupPart;

export default interface ChatSelectedModel {
	provider: LlmProvider;
	modelId: string;
} /** A group of user and response (agent) messages */

export interface MessageGroup {
	user: UIMessage;
	/** The response (agent) messages */
	responses: UIMessage[];
}
