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
	textBlockCount: number;
	isNewChat: boolean;
	modelId: string | undefined;
	timezone: string | undefined;
};

export type SqlOutput = {
	name: string | null;
	rows: Record<string, unknown>[];
};

export type ToolCallEntry = {
	type: string;
	input: Record<string, string>;
	toolCallId: string;
};

export type StreamState = {
	renderedToolCallIds: Set<string>;
	sqlOutputs: Map<string, SqlOutput>;
	lastUpdateAt: number;
	toolGroup: Map<string, ToolCallEntry>;
	toolGroupBlockIndex: number;
};

export type Provider = 'slack' | 'teams' | 'telegram' | 'mattermost' | 'whatsapp' | 'automation';

export const SLACK_TRANSPORT_MODES = ['webhook', 'socket'] as const;
export type SlackTransportMode = (typeof SLACK_TRANSPORT_MODES)[number];

export const SLACK_REPLY_MODES = ['thread', 'mention'] as const;
export type SlackReplyMode = (typeof SLACK_REPLY_MODES)[number];

export type SlackSettings = {
	slackBotToken: string;
	slackSigningSecret: string;
	slackllmProvider: string;
	slackllmModelId: string;
	autoCreateUsersEnabled?: boolean;
	autoCreateUsersDomains?: string[];
	slackTransportMode?: SlackTransportMode;
	slackAppToken?: string;
	slackReplyMode?: SlackReplyMode;
	// Who last wrote the credential/transport fields: 'env' after the boot-time
	// SLACK_* seed, absent after a Settings > Slack credentials save (which hands
	// ownership to the UI so the seed stops overwriting). Edits to UI-managed
	// fields (model, reply mode, auto-create users) leave ownership untouched.
	slackSettingsSource?: 'env';
};

export type TeamsSettings = {
	teamsAppId: string;
	teamsAppPassword: string;
	teamsTenantId: string;
	teamsLlmProvider: string;
	teamsLlmModelId: string;
};

export type TelegramSettings = {
	telegramBotToken: string;
	telegramLlmProvider: string;
	telegramLlmModelId: string;
};

export type MattermostSettings = {
	mattermostBaseUrl: string;
	mattermostBotToken: string;
	mattermostLlmProvider: string;
	mattermostLlmModelId: string;
	mattermostInteractiveButtonsEnabled?: boolean;
	mattermostCallbackUrl?: string;
};

export type WhatsappSettings = {
	whatsappAccessToken: string;
	whatsappAppSecret: string;
	whatsappPhoneNumberId: string;
	whatsappVerifyToken: string;
	whatsappLlmProvider: string;
	whatsappLlmModelId: string;
};
