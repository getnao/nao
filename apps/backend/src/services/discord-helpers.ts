import type { DiscordAdapter } from '@chat-adapter/discord';
import type { UserRole } from '@nao/shared/types';
import type { AdapterPostableMessage } from 'chat';
import { Card, CardText, type FileUpload } from 'chat';

import type { SqlOutput } from '../types/messaging-provider';
import { createStopButtonActions } from '../utils/messaging-provider';

export const DISCORD_ANSWERING_PLACEHOLDER = '✨ nao is answering...';

/**
 * The answer post carries Discord's message-content limit, so a longer answer is uploaded whole. The
 * name is deliberate: the body is markdown, and Discord previews `.md` as text.
 */
export const DISCORD_OVERFLOW_FILENAME = 'answer.md';
export const DISCORD_TRUNCATION_NOTICE = '\n\n_Response truncated. Open the full result in nao._';
export const DISCORD_ATTACHMENT_NOTICE = '\n\n_Response truncated. The full answer is attached below._';

/**
 * The roles the Discord bot answers for. The same predicate gates every inbound message and the
 * fallback user at save time -- a fallback outside these roles would save fine and then be denied
 * on every message, so the settings form has to reject it up front.
 */
export const canUseDiscordInProject = (role: UserRole | null | undefined): boolean =>
	role === 'admin' || role === 'user' || role === 'context_admin';

/**
 * The Discord answer postable. Deliberately always a Card, never a bare markdown postable: the adapter
 * writes `content` for markdown but leaves whatever embed and components a card wrote earlier in place,
 * so switching between the two mid-stream renders the same answer twice -- the markdown content plus the
 * card's stale embed, behind a Stop button that has already been detached.
 */
export const buildDiscordAnswerPostable = (message: string, stopAttached: boolean): AdapterPostableMessage =>
	Card({
		children: [
			CardText(message || DISCORD_ANSWERING_PLACEHOLDER),
			// Kept on the message even after generation ends, greyed out: the adapter only sends
			// `components` when the card has some, so dropping the row would leave the previous,
			// still-clickable Stop button on the message instead of clearing it.
			createStopButtonActions(!stopAttached),
		],
	});

export const DISCORD_POST_MAX_LENGTH = 2_000;
export const DISCORD_TABLE_ROW_LIMIT = 20;
export const DISCORD_THUMBS_UP = '👍';
export const DISCORD_THUMBS_DOWN = '👎';

export type DiscordLoginCommand = {
	code: string;
};

export type DiscordReactionFeedback =
	| { action: 'upsert'; vote: 'up' | 'down' }
	| { action: 'delete'; vote: 'up' | 'down' };

export type DiscordAuthorType = 'bot' | 'human' | 'unknown';

export class DiscordConnectionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DiscordConnectionError';
	}
}

export type DiscordEmailCacheEntry = {
	email: string | null;
	expiresAt: number;
};

export type DiscordEmailCache = Map<string, DiscordEmailCacheEntry>;

export function resolveDiscordReactionFeedback(input: {
	added: boolean;
	emojiName: string;
	isBot: boolean;
}): DiscordReactionFeedback | null {
	if (input.isBot) {
		return null;
	}
	const normalized = input.emojiName.toLowerCase();
	const vote =
		normalized === 'thumbs_up' || normalized === DISCORD_THUMBS_UP || normalized === '+1'
			? 'up'
			: normalized === 'thumbs_down' || normalized === DISCORD_THUMBS_DOWN || normalized === '-1'
				? 'down'
				: null;
	if (!vote) {
		return null;
	}
	return { action: input.added ? 'upsert' : 'delete', vote };
}

export function shouldHandleDiscordMessage(input: {
	isDirectMessage: boolean;
	isThreadReply: boolean;
	isMention: boolean;
	hasExistingChat: boolean;
	authorType: DiscordAuthorType;
	isOwnMessage: boolean;
}): boolean {
	if (input.authorType === 'bot' || input.isOwnMessage) {
		return false;
	}
	if (input.isMention) {
		return true;
	}
	if (input.authorType === 'unknown') {
		return input.isDirectMessage && !input.isThreadReply;
	}
	if (!input.isDirectMessage) {
		return input.hasExistingChat;
	}
	return !input.isThreadReply || input.hasExistingChat;
}

/** Raw Discord message content mentions users as `<@id>`/`<@!id>` and roles as `<@&id>`. */
export function hasExplicitDiscordMention(raw: unknown, bot: { userId?: string; mentionRoleIds?: string[] }): boolean {
	const content = raw && typeof raw === 'object' ? (raw as { content?: unknown }).content : undefined;
	if (typeof content !== 'string' || !content) {
		return false;
	}
	const userMentions = new Set(extractDiscordMentionIds(content, /<@!?(\d+)>/g));
	if (bot.userId && userMentions.has(bot.userId)) {
		return true;
	}
	const roleMentions = new Set(extractDiscordMentionIds(content, /<@&(\d+)>/g));
	return (bot.mentionRoleIds ?? []).some((roleId) => roleMentions.has(roleId));
}

export async function resolveDiscordSqlOutput(input: {
	queryId: string;
	sqlOutputs: Map<string, SqlOutput>;
	loadPersisted: (queryId: string) => Promise<SqlOutput | null>;
}): Promise<SqlOutput | undefined> {
	const inStream = input.sqlOutputs.get(input.queryId);
	if (inStream) {
		return inStream;
	}
	try {
		const persisted = await input.loadPersisted(input.queryId);
		if (!persisted) {
			return undefined;
		}
		input.sqlOutputs.set(input.queryId, persisted);
		return persisted;
	} catch {
		return undefined;
	}
}

export function parseDiscordLoginCommand(text: string): DiscordLoginCommand | null {
	const match = /^\s*\/?login\s+([a-z0-9_-]{8})\s*$/i.exec(text);
	if (!match) {
		return null;
	}
	return { code: match[1].toLowerCase() };
}

export function getDiscordLoginCommandForUnlinkedUser(
	text: string,
	isAuthorLinked: boolean,
): DiscordLoginCommand | null {
	if (isAuthorLinked) {
		return null;
	}
	return parseDiscordLoginCommand(text);
}

export function createDiscordMarkdownTable(input: {
	title: string;
	rows: Record<string, unknown>[] | null | undefined;
}): string | null {
	if (!input.rows?.length) {
		return null;
	}
	const allColumns = Object.keys(input.rows[0]);
	if (allColumns.length === 0) {
		return null;
	}
	const columns = allColumns.slice(0, DISCORD_TABLE_COLUMN_LIMIT);
	const fixedLines = [
		`**${formatCell(input.title)}**`,
		'',
		`| ${columns.map(formatCell).join(' | ')} |`,
		`| ${columns.map(() => '---').join(' | ')} |`,
	];
	const dataLines: string[] = [];
	for (const row of input.rows.slice(0, DISCORD_TABLE_ROW_LIMIT)) {
		const line = `| ${columns.map((column) => formatCell(row[column])).join(' | ')} |`;
		const omittedRows = input.rows.length - dataLines.length - 1;
		const candidate = [
			...fixedLines,
			...dataLines,
			line,
			...createOmissionLines(omittedRows, allColumns.length - columns.length),
		]
			.join('\n')
			.trim();
		if (candidate.length > DISCORD_TABLE_MAX_LENGTH) {
			break;
		}
		dataLines.push(line);
	}
	return [
		...fixedLines,
		...dataLines,
		...createOmissionLines(input.rows.length - dataLines.length, allColumns.length - columns.length),
	]
		.join('\n')
		.trim();
}

export function truncateDiscordMarkdown(
	markdown: string,
	maxLength = DISCORD_POST_MAX_LENGTH,
	notice = DISCORD_TRUNCATION_NOTICE,
): string {
	if (markdown.length <= maxLength) {
		return markdown;
	}
	const available = Math.max(maxLength - notice.length, 0);
	const prefix = markdown.slice(0, available);
	const lastLineBreak = prefix.lastIndexOf('\n');
	const safePrefix = prefix.slice(0, lastLineBreak > 0 ? lastLineBreak : available).trimEnd();
	return `${safePrefix}${notice}`.slice(0, maxLength);
}

/**
 * The answer as an upload, or null when it already fits one post. The trigger IS the length check that
 * truncates the post, so the file carries exactly what the message could not: no size heuristic and no
 * per-project setting to keep in sync. Bounded in practice by the table caps (~12k characters); Discord
 * allows a bot 10 MiB per file.
 */
export function createDiscordAnswerAttachment(body: string, maxLength = DISCORD_POST_MAX_LENGTH): FileUpload | null {
	if (body.length <= maxLength) {
		return null;
	}
	return {
		data: Buffer.from(body, 'utf8'),
		filename: DISCORD_OVERFLOW_FILENAME,
		mimeType: 'text/markdown',
	};
}

export async function resolveDiscordAccount<T>(input: {
	userId: string;
	emailCache: DiscordEmailCache;
	fetchEmail: () => Promise<string | null>;
	findUser: (email: string) => Promise<T | null>;
	now?: () => number;
}): Promise<T | null> {
	const cachedEntry = input.emailCache.get(input.userId);
	if (cachedEntry && cachedEntry.expiresAt > (input.now ?? Date.now)()) {
		return cachedEntry.email ? input.findUser(cachedEntry.email) : null;
	}

	const email = await input.fetchEmail();
	cacheDiscordEmail(input.emailCache, input.userId, email, (input.now ?? Date.now)());
	if (!email) {
		return null;
	}
	const normalizedEmail = email.toLowerCase();
	return input.findUser(normalizedEmail);
}

export function cacheDiscordEmail(
	emailCache: DiscordEmailCache,
	userId: string,
	email: string | null,
	now = Date.now(),
): void {
	const normalizedEmail = email ? email.toLowerCase() : null;
	emailCache.set(userId, {
		email: normalizedEmail,
		expiresAt: normalizedEmail ? Number.POSITIVE_INFINITY : now + MISSING_EMAIL_CACHE_TTL_MS,
	});
}

export async function fetchDiscordUserEmail(input: {
	adapter: DiscordAdapter;
	userId: string;
}): Promise<string | null> {
	const user = await input.adapter.getUser(input.userId);
	return user?.email ?? null;
}

export async function validateDiscordConnection(input: {
	botToken: string;
	apiUrl?: string;
	fetchImpl?: typeof fetch;
}): Promise<void> {
	const apiUrl = input.apiUrl ?? 'https://discord.com/api/v10';
	let response: Response;
	try {
		response = await (input.fetchImpl ?? fetch)(`${apiUrl}/users/@me`, {
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

const DISCORD_TABLE_COLUMN_LIMIT = 20;
const DISCORD_TABLE_CELL_LIMIT = 160;
const DISCORD_TABLE_MAX_LENGTH = 12_000;
const MISSING_EMAIL_CACHE_TTL_MS = 5 * 60 * 1000;

function extractDiscordMentionIds(content: string, pattern: RegExp): string[] {
	return [...content.matchAll(pattern)].map((match) => match[1]);
}

function createOmissionLines(omittedRows: number, omittedColumns: number): string[] {
	const lines: string[] = [];
	if (omittedRows > 0) {
		lines.push(`_${omittedRows} ${omittedRows === 1 ? 'row' : 'rows'} omitted. Open the full result in nao._`);
	}
	if (omittedColumns > 0) {
		lines.push(
			`_${omittedColumns} ${omittedColumns === 1 ? 'column' : 'columns'} omitted. Open the full result in nao._`,
		);
	}
	return lines.length > 0 ? ['', ...lines] : lines;
}

function formatCell(value: unknown): string {
	const text = stringifyCell(value).replace(/\r?\n|\r/g, '<br>');
	const truncated = text.length > DISCORD_TABLE_CELL_LIMIT ? `${text.slice(0, DISCORD_TABLE_CELL_LIMIT - 1)}…` : text;
	return truncated.replace(/\|/g, '\\|');
}

function stringifyCell(value: unknown): string {
	if (value === null || value === undefined) {
		return '';
	}
	if (typeof value === 'object') {
		try {
			return JSON.stringify(value);
		} catch {
			return String(value);
		}
	}
	return String(value);
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
