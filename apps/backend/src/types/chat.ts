import {
	DynamicToolUIPart,
	FinishReason,
	type InferUITools,
	ToolUIPart as ToolUIPartType,
	type UIMessage as UIGenericMessage,
	UIMessagePart as UIGenericMessagePart,
} from 'ai';
import z from 'zod/v4';

import { tools } from '../agents/tools';
import { MessageFeedback } from '../db/abstractSchema';
import { llmProviderSchema } from './llm';

export interface UIChat {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messages: UIMessage[];
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

export type UIMessage = UIGenericMessage<unknown, MessageCustomDataParts, UITools> & {
	feedback?: MessageFeedback;
};

export type UITools = InferUITools<typeof tools>;

/** Additional data parts that are not part of the ai sdk data parts */
export type MessageCustomDataParts = {
	/** Sent when a new chat is created */
	newChat: ChatListItem;
	/** Maps the client-generated user message ID to the server-generated one */
	newUserMessage: { newId: string };
};

export type UIMessagePart = UIGenericMessagePart<MessageCustomDataParts, UITools>;

/** Tools that are statically defined in the code (e.g. built-in tools) */
export type UIStaticToolPart = ToolUIPartType<UITools>;

export type StaticToolName = keyof UITools;

/** Either a static or dynamic tool part (e.g. MCP tools) */
export type UIToolPart<TToolName extends StaticToolName | undefined = undefined> = TToolName extends StaticToolName
	? UIStaticToolPart & { type: `tool-${TToolName}` }
	: UIStaticToolPart | DynamicToolUIPart;

export type ToolState = UIToolPart['state'];

export type UIMessagePartType = UIMessagePart['type'];

export type StopReason = FinishReason | 'interrupted';

export type TokenUsage = {
	inputTotalTokens?: number;
	inputNoCacheTokens?: number;
	inputCacheReadTokens?: number;
	inputCacheWriteTokens?: number;
	outputTotalTokens?: number;
	outputTextTokens?: number;
	outputReasoningTokens?: number;
	totalTokens?: number;
};

export type TokenCost = {
	inputNoCache?: number;
	inputCacheRead?: number;
	inputCacheWrite?: number;
	output?: number;
	totalCost?: number;
};

/**
 * Agent Request Types
 */

export type Mention = z.infer<typeof MentionSchema>;
export const MentionSchema = z.object({
	id: z.string(),
	trigger: z.string(),
	label: z.string(),
});

export type AgentRequestUserMessage = z.infer<typeof AgentRequestUserMessageSchema>;
export const AgentRequestUserMessageSchema = z.object({
	text: z.string(),
});

const ModelSelectionSchema = z.object({
	provider: llmProviderSchema,
	modelId: z.string(),
});

export type AgentRequest = z.infer<typeof AgentRequestSchema>;
export const AgentRequestSchema = z.object({
	message: AgentRequestUserMessageSchema,
	chatId: z.string().optional(),
	messageToEditId: z.string().optional(),
	model: ModelSelectionSchema.optional(),
	mentions: z.array(MentionSchema).optional(),
});
