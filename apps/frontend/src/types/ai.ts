import type { ReasoningUIPart } from 'ai';
import type { UIToolPart, UIMessagePart } from '@nao/backend/chat';

/** A collapsible part can be either a tool or reasoning */
export type CollapsiblePart = UIToolPart | ReasoningUIPart;

/** A grouped set of consecutive collapsible parts (tools and reasoning) */
export type ToolGroupPart = { type: 'tool-group'; parts: CollapsiblePart[] };

/** Union of regular message parts and tool groups */
export type GroupedMessagePart = UIMessagePart | ToolGroupPart;
