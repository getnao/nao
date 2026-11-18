import { cardToDiscordPayload, DiscordFormatConverter } from '@chat-adapter/discord';
import type { UserRole } from '@nao/shared/types';
import { Card, type FileUpload } from 'chat';

import type { ReactionFeedback } from '../utils/markdown-messaging';
import { createStopButtonActions } from '../utils/messaging-provider';

export const DISCORD_ANSWERING_PLACEHOLDER = '✨ nao is answering...';
export const DISCORD_POST_MAX_LENGTH = 2_000;
export const DISCORD_OVERFLOW_FILENAME = 'answer.md';
export const DISCORD_ATTACHMENT_NOTICE = '\n\n_Response truncated. The full answer is attached below._';
export const DISCORD_THUMBS_UP = '👍';
export const DISCORD_THUMBS_DOWN = '👎';
export const DISCORD_LOGIN_CODE_PROMPT =
	'👋 I could not match your Discord account. Send `login <your-code>` to link manually. Find your code in project settings.';

export class DiscordConnectionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DiscordConnectionError';
	}
}

export const canUseDiscordInProject = (role: UserRole | null | undefined): boolean =>
	role === 'admin' || role === 'user' || role === 'context_admin';

export type DiscordAnswerPayload = {
	content: string;
	components: DiscordComponents;
	flags: number;
};

/**
 * Answers are plain message content: adapter cards render as an embed, which reads like a quote.
 * The adapter only sends `components` for cards, so answers are edited through the REST API directly
 * to be able to drop the Stop row once generation ends.
 */
export function buildDiscordAnswerPayload(message: string, stopAttached: boolean): DiscordAnswerPayload {
	return {
		content: message || DISCORD_ANSWERING_PLACEHOLDER,
		components: stopAttached ? createStopButtonComponents() : [],
		flags: DISCORD_SUPPRESS_EMBEDS_FLAG,
	};
}

export async function editDiscordMessage(input: {
	botToken: string;
	channelId: string;
	messageId: string;
	payload: DiscordAnswerPayload;
	fetchImpl?: typeof fetch;
}): Promise<void> {
	const response = await (input.fetchImpl ?? fetch)(
		`${DISCORD_API_URL}/channels/${input.channelId}/messages/${input.messageId}`,
		{
			method: 'PATCH',
			headers: {
				Authorization: `Bot ${input.botToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(input.payload),
		},
	);
	if (!response.ok) {
		throw new Error(`Discord message edit failed (HTTP ${response.status}): ${await response.text()}`);
	}
}

/** Discord does not render GFM tables, so they become aligned code blocks. */
export function formatDiscordTable(markdownTable: string): string {
	return new DiscordFormatConverter().fromMarkdown(markdownTable);
}

export function createDiscordAnswerAttachment(body: string, maxLength: number): FileUpload | null {
	if (body.length <= maxLength) {
		return null;
	}
	return {
		data: Buffer.from(body, 'utf8'),
		filename: DISCORD_OVERFLOW_FILENAME,
		mimeType: 'text/markdown',
	};
}

export function resolveDiscordReactionFeedback(input: {
	added: boolean;
	emojiName: string;
	isBot: boolean;
}): ReactionFeedback | null {
	if (input.isBot) {
		return null;
	}
	const vote = UP_VOTE_EMOJIS.has(input.emojiName.toLowerCase())
		? 'up'
		: DOWN_VOTE_EMOJIS.has(input.emojiName.toLowerCase())
			? 'down'
			: null;
	if (!vote) {
		return null;
	}
	return { action: input.added ? 'upsert' : 'delete', vote };
}

/** Raw Discord message content mentions users as `<@id>`/`<@!id>` and roles as `<@&id>`. */
export function hasExplicitDiscordMention(raw: unknown, bot: { userId?: string; mentionRoleIds?: string[] }): boolean {
	const content = raw && typeof raw === 'object' ? (raw as { content?: unknown }).content : undefined;
	if (typeof content !== 'string' || !content) {
		return false;
	}
	const userMentions = new Set(extractMentionIds(content, /<@!?(\d+)>/g));
	if (bot.userId && userMentions.has(bot.userId)) {
		return true;
	}
	const roleMentions = new Set(extractMentionIds(content, /<@&(\d+)>/g));
	return (bot.mentionRoleIds ?? []).some((roleId) => roleMentions.has(roleId));
}

export async function validateDiscordConnection(input: { botToken: string; fetchImpl?: typeof fetch }): Promise<void> {
	let response: Response;
	try {
		response = await (input.fetchImpl ?? fetch)(`${DISCORD_API_URL}/users/@me`, {
			headers: {
				Accept: 'application/json',
				Authorization: `Bot ${input.botToken}`,
			},
		});
	} catch {
		throw new DiscordConnectionError('Could not reach the Discord API. Check your network and try again.');
	}

	if (response.status === 401 || response.status === 403) {
		throw new DiscordConnectionError('Discord rejected the bot token. Check the token and try again.');
	}
	if (!response.ok) {
		throw new DiscordConnectionError(`Discord connection failed (HTTP ${response.status}).`);
	}

	let user: unknown;
	try {
		user = await response.json();
	} catch {
		throw new DiscordConnectionError('Discord returned an unexpected response.');
	}
	if (!isDiscordUser(user)) {
		throw new DiscordConnectionError('Discord returned an unexpected response.');
	}
}

type DiscordComponents = ReturnType<typeof cardToDiscordPayload>['components'];

const DISCORD_API_URL = 'https://discord.com/api/v10';
const DISCORD_SUPPRESS_EMBEDS_FLAG = 1 << 2;
const UP_VOTE_EMOJIS = new Set(['thumbs_up', '+1', DISCORD_THUMBS_UP]);
const DOWN_VOTE_EMOJIS = new Set(['thumbs_down', '-1', DISCORD_THUMBS_DOWN]);

function createStopButtonComponents(): DiscordComponents {
	return cardToDiscordPayload(Card({ children: [createStopButtonActions()] })).components;
}

function extractMentionIds(content: string, pattern: RegExp): string[] {
	return [...content.matchAll(pattern)].map((match) => match[1]);
}

function isDiscordUser(value: unknown): value is { id: string } {
	return (
		Boolean(value) &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		typeof (value as { id?: unknown }).id === 'string' &&
		Boolean((value as { id: string }).id.trim())
	);
}
