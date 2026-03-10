import { CardChild, Message, SentMessage, Thread } from 'chat';

import { User } from '../db/abstractSchema';
import { UIMessage } from '../types/chat';

export type ConversationContext = {
	thread: Thread;
	userMessage: Message;
	user: User | null;
	chatId: string;
	assistantMessage: UIMessage | null;
	convMessage: SentMessage | null;
	blocks: CardChild[];
	textBlockIndex: number;
	isNewChat: boolean;
	modelId: string | undefined;
};

type SqlOutput = {
	name: string | null;
	rows: Record<string, unknown>[];
};

export type ToolCallEntry = {
	type: string;
	input: Record<string, string>;
	toolCallId: string;
};

export type StreamState = {
	renderedChartIds: Set<string>;
	sqlOutputs: Map<string, SqlOutput>;
	lastUpdateAt: number;
	toolGroup: Map<string, ToolCallEntry>;
	toolGroupBlockIndex: number;
};
