import {
	DynamicToolUIPart,
	type InferUITools,
	ToolUIPart as ToolUIPartType,
	type UIMessage as UIGenericMessage,
	UIMessagePart as UIGenericMessagePart,
} from 'ai';

import { tools } from '../agents/tools';

export interface UIChat {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messages: unknown[];
}

export interface ListChatResponse {
	chats: ChatListItem[];
}

export interface ChatListItem {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
}

export type UIMessage = UIGenericMessage<unknown, MessageCustomDataParts, UITools>;
export type UITools = InferUITools<typeof tools>;

/** Additional data parts that are not part of the ai sdk data parts */
export type MessageCustomDataParts = {
	/** Sent when a new chat is created */
	newChat: ChatListItem;
};

export type UIMessagePart = UIGenericMessagePart<MessageCustomDataParts, UITools>;

/** Tools that are statically defined in the code (e.g. built-in tools) */
export type UIStaticToolPart = ToolUIPartType<UITools>;

export type StaticToolName = `tool-${keyof UITools}`;

/** Either a static or dynamic tool part (e.g. MCP tools) */
export type UIToolPart = UIStaticToolPart | DynamicToolUIPart;

export type ToolState = UIToolPart['state'];

export type UIMessagePartType = UIMessagePart['type'];
