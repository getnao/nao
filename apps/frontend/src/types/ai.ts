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

/** Consecutive query tool calls rendered as one card, with any reasoning the model wrote between them. */
export type QueryGroupPart = { type: 'query-group'; parts: GroupablePart[] };

/** A story action superseded by a later action on the same story, shown as a status line instead of a card. */
export type StoryStatusPart = { type: 'story-status'; part: UIToolPart<'story'> };

export type StoryQueryGroupItem = GroupablePart | StoryStatusPart;

/** Story status rows shown together with the query runs immediately around them. */
export type StoryQueryGroupPart = { type: 'story-query-group'; parts: StoryQueryGroupItem[] };

/** Union of regular message parts and tool groups */
export type GroupedMessagePart = UIMessagePart | ToolGroupPart | QueryGroupPart | StoryStatusPart | StoryQueryGroupPart;

/** A group of user and assistant messages. */
export interface MessageGroup {
	userMessage: UIMessage | null;
	assistantMessages: UIMessage[];
}
