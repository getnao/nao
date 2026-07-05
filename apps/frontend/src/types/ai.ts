import type { ReasoningUIPart } from 'ai';
import type { UIToolPart, UIMessagePart, UIMessage } from '@nao/backend/chat';

/** A collapsible part can be either a tool or reasoning */
export type GroupablePart = UIToolPart | ReasoningUIPart;

/** A grouped set of consecutive collapsible parts (tools and reasoning) */
export type ToolGroupPart = { type: 'tool-group'; parts: GroupablePart[] };

/** A nested group of consecutive MCP parts targeting the same server. */
export type McpSubGroupPart = { type: 'mcp-sub-group'; id: string; server: string; parts: GroupablePart[] };

/** A groupable part or a nested MCP sub-group, as rendered inside a tool group. */
export type McpGroupedPart = GroupablePart | McpSubGroupPart;

/** Union of regular message parts and tool groups */
export type GroupedMessagePart = UIMessagePart | ToolGroupPart;

/** A group of user and assistant messages. */
export interface MessageGroup {
	userMessage: UIMessage | null;
	assistantMessages: UIMessage[];
}
