import { DynamicToolUIPart, type InferUITools, ToolUIPart as ToolUIPartType, type UIMessage, UIMessagePart } from 'ai';

import { tools } from '../agents/tools';

export interface Chat {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messages: unknown[];
}

export interface ChatListItem {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
}

export type Message = UIMessage<unknown, MessageCustomDataParts, UITools>;
export type UITools = InferUITools<typeof tools>;

/** Additional data parts that are not part of the ai sdk data parts */
export type MessageCustomDataParts = {
	/** Sent when a new chat is created */
	newChat: {
		id: string;
		title: string;
		createdAt: number;
		updatedAt: number;
	};
};

export type MessagePart = UIMessagePart<MessageCustomDataParts, UITools>;

/** Tools that are statically defined in the code (e.g. built-in tools) */
export type StaticToolUIPart = ToolUIPartType<UITools>;

/** Either a static or dynamic tool part (e.g. MCP tools) */
export type ToolUIPart = StaticToolUIPart | DynamicToolUIPart;
