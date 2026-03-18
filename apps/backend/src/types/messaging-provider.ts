import { CardChild, Message, SentMessage, Thread } from 'chat';

import { User } from '../db/abstractSchema';

export type ConversationContext = {
	thread: Thread;
	userMessage: Message;
	user: User | null;
	chatId: string;
	convMessage: SentMessage | null;
	blocks: CardChild[];
	textBlockIndex: number;
	isNewChat: boolean;
	modelId: string | undefined;
	timezone: string | undefined;
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

export type Provider = 'slack' | 'teams';

export type SlackSettings = {
	slackBotToken: string;
	slackSigningSecret: string;
	slackllmProvider: string;
	slackllmModelId: string;
};

export type TeamsSettings = {
	teamsAppId: string;
	teamsAppPassword: string;
	teamsTenantId: string;
	teamsLlmProvider: string;
	teamsLlmModelId: string;
};
