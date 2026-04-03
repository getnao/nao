import { ALLOWED_IMAGE_MEDIA_TYPES } from '@nao/shared/types';
import {
	DynamicToolUIPart,
	FinishReason,
	type InferUITools,
	ToolUIPart as ToolUIPartType,
	type UIMessage as UIGenericMessage,
	UIMessagePart as UIGenericMessagePart,
} from 'ai';
import z from 'zod/v4';

import { getTools, tools } from '../agents/tools';
import { MessageFeedback } from '../db/abstractSchema';
import { llmSelectedModelSchema } from './llm';

export interface ForkMetadata {
	type: 'chat' | 'chat_selection' | 'story' | 'story_selection';
	id: string;
	title: string;
	authorName: string;
	selectionStart?: number;
	selectionEnd?: number;
	selectionText?: string;
}

export interface UIChat {
	id: string;
	title: string;
	isStarred: boolean;
	createdAt: number;
	updatedAt: number;
	messages: UIMessage[];
	forkMetadata?: ForkMetadata;
}

export interface ListChatResponse {
	chats: ChatListItem[];
}

export interface ChatListItem {
	id: string;
	title: string;
	isStarred: boolean;
	createdAt: number;
	updatedAt: number;
}

export type UIMessage = UIGenericMessage<unknown, MessageCustomDataParts, UITools> & {
	feedback?: MessageFeedback;
	source?: 'slack' | 'teams' | 'telegram' | 'whatsapp' | 'web';
	isForked?: boolean;
};

export type UITools = InferUITools<typeof tools>;

/** Additional data parts that are not part of the ai sdk data parts */
export type MessageCustomDataParts = {
	/** Sent when a new chat is created */
	newChat: ChatListItem;
	/** Sent when an LLM-generated title replaces the initial placeholder */
	chatTitleUpdate: { title: string };
	/** Maps the client-generated user message ID to the server-generated one */
	newUserMessage: { newId: string };
	/** Sent when conversation compaction is triggered */
	compactionSummaryStarted: undefined;
	/** Sent when the conversation compaction summary is finished */
	compaction: CompactionPart;
};

export interface CompactionPart {
	/** The summary of the compaction */
	summary: string;
	error?: string;
}

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
	inputTotalTokens: number | undefined;
	inputNoCacheTokens: number | undefined;
	inputCacheReadTokens: number | undefined;
	inputCacheWriteTokens: number | undefined;
	outputTotalTokens: number | undefined;
	outputTextTokens: number | undefined;
	outputReasoningTokens: number | undefined;
	totalTokens: number | undefined;
};

export type TokenCost = {
	inputNoCache?: number;
	inputCacheRead?: number;
	inputCacheWrite?: number;
	output?: number;
	totalCost?: number;
};

export type ContextUsage = {
	tokensUsed: number;
	contextWindow: number | null;
};

export type AgentTools = Awaited<ReturnType<typeof getTools>>;

/**
 * Agent Request Types
 */

export type Mention = z.infer<typeof MentionSchema>;
export const MentionSchema = z.object({
	id: z.string(),
	trigger: z.string(),
	label: z.string(),
});

export const AgentRequestImageSchema = z.object({
	mediaType: z.enum(ALLOWED_IMAGE_MEDIA_TYPES),
	data: z.string().min(1),
});

export type AgentRequestUserMessage = z.infer<typeof AgentRequestUserMessageSchema>;
export const AgentRequestUserMessageSchema = z.object({
	text: z.string(),
	images: z.array(AgentRequestImageSchema).optional(),
});

export type AgentRequest = z.infer<typeof AgentRequestSchema>;
export const AgentRequestSchema = z.object({
	message: AgentRequestUserMessageSchema,
	chatId: z.string().optional(),
	messageToEditId: z.string().optional(),
	model: llmSelectedModelSchema.optional(),
	mentions: z.array(MentionSchema).optional(),
	timezone: z.string().optional(),
});
