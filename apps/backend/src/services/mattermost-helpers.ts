import { createHmac, timingSafeEqual } from 'node:crypto';

import type { MattermostAdapter } from 'chat-adapter-mattermost';

import { env } from '../env';
import type { SqlOutput } from '../types/messaging-provider';

export const MATTERMOST_CALLBACK_CONTENT_TYPE = 'application/json';
export const MATTERMOST_FEEDBACK_PROP = 'nao_feedback';
export const MATTERMOST_POST_MAX_LENGTH = 16_383;
export const MATTERMOST_TABLE_ROW_LIMIT = 20;

export type MattermostLoginCommand = {
	code: string;
};

export type MattermostReactionFeedback =
	| { action: 'upsert'; vote: 'up' | 'down' }
	| { action: 'delete'; vote: 'up' | 'down' };

export type MattermostAuthorType = 'bot' | 'human' | 'unknown';

export type MattermostFeedbackMetadata = {
	version: 1;
	assistantMessageId: string;
	signature: string;
};

export type MattermostFeedbackMetadataValidation =
	| { valid: true; assistantMessageId: string }
	| { valid: false; reason: 'missing' | 'malformed' | 'invalid_signature' };

export class MattermostConnectionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MattermostConnectionError';
	}
}

export type MattermostStopAttachment = {
	color: '#522bff';
	actions: [
		{
			id: 'stop_generation';
			name: 'Stop';
			type: 'button';
			integration: {
				url: string;
				context: { action_id: 'stop_generation'; token: string };
			};
		},
	];
};

export type MattermostAnswerPatchBody = {
	message: string;
	props: Record<string, unknown> & {
		attachments: MattermostStopAttachment[];
	};
};

export type MattermostPostPlacement = {
	id: string;
	channel_id: string;
	root_id?: string;
	message?: string;
	props?: {
		mentions?: unknown;
		mentioned_user_ids?: unknown;
		[key: string]: unknown;
	};
};

export type MattermostEmailCacheEntry = {
	email: string | null;
	expiresAt: number;
};

export type MattermostEmailCache = Map<string, MattermostEmailCacheEntry>;

export function createMattermostActionSecret(projectId: string, postId: string): string {
	return createHmac('sha256', env.BETTER_AUTH_SECRET).update(`mattermost:${projectId}:${postId}`).digest('base64url');
}

export function verifyMattermostActionSecret(projectId: string, postId: string, candidate: unknown): boolean {
	if (typeof candidate !== 'string') {
		return false;
	}
	const expected = createMattermostActionSecret(projectId, postId);
	return timingSafeStringEqual(expected, candidate);
}

export function createMattermostFeedbackMetadata(
	projectId: string,
	postId: string,
	assistantMessageId: string,
): MattermostFeedbackMetadata {
	return {
		version: 1,
		assistantMessageId,
		signature: createMattermostFeedbackSignature(projectId, postId, assistantMessageId),
	};
}

export function verifyMattermostFeedbackMetadata(
	props: unknown,
	projectId: string,
	postId: string,
): MattermostFeedbackMetadataValidation {
	if (!props || typeof props !== 'object' || Array.isArray(props) || !(MATTERMOST_FEEDBACK_PROP in props)) {
		return { valid: false, reason: 'missing' };
	}
	const metadata = (props as Record<string, unknown>)[MATTERMOST_FEEDBACK_PROP];
	if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
		return { valid: false, reason: 'malformed' };
	}
	const { version, assistantMessageId, signature } = metadata as Record<string, unknown>;
	if (
		version !== 1 ||
		typeof assistantMessageId !== 'string' ||
		assistantMessageId.length === 0 ||
		typeof signature !== 'string'
	) {
		return { valid: false, reason: 'malformed' };
	}
	const expected = createMattermostFeedbackSignature(projectId, postId, assistantMessageId);
	if (!timingSafeStringEqual(expected, signature)) {
		return { valid: false, reason: 'invalid_signature' };
	}
	return { valid: true, assistantMessageId };
}

export function createMattermostCallbackResponse(): Record<string, never> {
	return {};
}

export function parseMattermostLoginCommand(text: string): MattermostLoginCommand | null {
	const match = /^\s*\/?login\s+([a-z0-9_-]{8})\s*$/i.exec(text);
	if (!match) {
		return null;
	}
	return { code: match[1].toLowerCase() };
}

export function getMattermostLoginCommandForUnlinkedUser(
	text: string,
	isAuthorLinked: boolean,
): MattermostLoginCommand | null {
	if (isAuthorLinked) {
		return null;
	}
	return parseMattermostLoginCommand(text);
}

export function resolveMattermostReactionFeedback(input: {
	added: boolean;
	emojiName: string;
	isBot: boolean;
}): MattermostReactionFeedback | null {
	if (input.isBot) {
		return null;
	}
	const vote = input.emojiName === 'thumbs_up' ? 'up' : input.emojiName === 'thumbs_down' ? 'down' : null;
	if (!vote) {
		return null;
	}
	return { action: input.added ? 'upsert' : 'delete', vote };
}

export function shouldHandleMattermostMessage(input: {
	isDirectMessage: boolean;
	isThreadReply: boolean;
	isMention: boolean;
	hasExistingChat: boolean;
	authorType: MattermostAuthorType;
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

export function hasExplicitMattermostMention(
	post: MattermostPostPlacement,
	bot: { userId?: string; userName?: string },
): boolean {
	const mentionTokens = new Set([
		...extractMentionTokens(post.props?.mentions),
		...extractMentionTokens(post.props?.mentioned_user_ids),
	]);
	if (bot.userId && mentionTokens.has(bot.userId)) {
		return true;
	}
	if (bot.userName && (mentionTokens.has(bot.userName) || mentionTokens.has(`@${bot.userName}`))) {
		return true;
	}
	if (!bot.userName) {
		return false;
	}
	const escapedUserName = escapeRegex(bot.userName);
	return new RegExp(`(^|\\s)@${escapedUserName}(?![\\w-])`, 'i').test(post.message ?? '');
}

export async function resolveMattermostSqlOutput(input: {
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

export function createMattermostStopAttachment(callbackUrl: string, token: string): MattermostStopAttachment {
	return {
		color: '#522bff',
		actions: [
			{
				id: 'stop_generation',
				name: 'Stop',
				type: 'button',
				integration: {
					url: callbackUrl,
					context: { action_id: 'stop_generation', token },
				},
			},
		],
	};
}

export function getMattermostPostBaseProps(raw: unknown): Record<string, unknown> {
	if (!raw || typeof raw !== 'object') {
		return {};
	}
	const props = (raw as { props?: unknown }).props;
	return props && typeof props === 'object' && !Array.isArray(props) ? { ...props } : {};
}

export function buildMattermostAnswerPatchBody(
	message: string,
	baseProps: Record<string, unknown>,
	attachments: MattermostStopAttachment[],
): MattermostAnswerPatchBody {
	return {
		message,
		props: {
			...baseProps,
			attachments,
		},
	};
}

export async function patchMattermostAnswerPost(input: {
	baseUrl: string;
	botToken: string;
	postId: string;
	message: string;
	baseProps: Record<string, unknown>;
	attachments: MattermostStopAttachment[];
	fetchImpl?: typeof fetch;
}): Promise<void> {
	const fetchImpl = input.fetchImpl ?? fetch;
	const url = createMattermostPostPatchUrl(input.baseUrl, input.postId);
	const headers = {
		Accept: 'application/json',
		Authorization: `Bearer ${input.botToken}`,
		'Content-Type': 'application/json',
	};
	const response = await fetchImpl(url, {
		method: 'PUT',
		headers,
		body: JSON.stringify(buildMattermostAnswerPatchBody(input.message, input.baseProps, input.attachments)),
	});
	if (!response.ok) {
		throw new Error(`Mattermost post patch failed with status ${response.status}`);
	}
}

export async function validateMattermostConnection(input: {
	baseUrl: string;
	botToken: string;
	fetchImpl?: typeof fetch;
}): Promise<void> {
	let response: Response;
	try {
		const url = createMattermostApiUrl(input.baseUrl, 'users/me');
		response = await (input.fetchImpl ?? fetch)(url, {
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${input.botToken}`,
			},
		});
	} catch {
		throw new MattermostConnectionError('Could not reach the Mattermost server. Check the server URL.');
	}

	if (response.status === 401 || response.status === 403) {
		throw new MattermostConnectionError('Mattermost rejected the bot token. Check the token and try again.');
	}
	if (response.status === 404) {
		throw new MattermostConnectionError('No Mattermost API was found at this server URL.');
	}
	if (!response.ok) {
		throw new MattermostConnectionError(`Mattermost connection failed (HTTP ${response.status}).`);
	}

	let user: unknown;
	try {
		user = await response.json();
	} catch {
		throw new MattermostConnectionError('Mattermost returned an unexpected response.');
	}
	if (!isMattermostUser(user)) {
		throw new MattermostConnectionError('Mattermost returned an unexpected response.');
	}
}

export async function fetchMattermostPost(input: {
	baseUrl: string;
	botToken: string;
	postId: string;
	fetchImpl?: typeof fetch;
}): Promise<MattermostPostPlacement | null> {
	const url = createMattermostPostUrl(input.baseUrl, input.postId);
	const response = await (input.fetchImpl ?? fetch)(url, {
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${input.botToken}`,
		},
	});
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new Error(`Mattermost post fetch failed with status ${response.status}`);
	}
	const post = (await response.json()) as Record<string, unknown>;
	if (post.id !== input.postId || typeof post.channel_id !== 'string') {
		throw new Error('Mattermost post fetch returned malformed data');
	}
	return post as MattermostPostPlacement;
}

export function createMattermostMarkdownTable(input: {
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
	const columns = allColumns.slice(0, MATTERMOST_TABLE_COLUMN_LIMIT);
	const fixedLines = [
		`**${formatCell(input.title)}**`,
		'',
		`| ${columns.map(formatCell).join(' | ')} |`,
		`| ${columns.map(() => '---').join(' | ')} |`,
	];
	const dataLines: string[] = [];
	for (const row of input.rows.slice(0, MATTERMOST_TABLE_ROW_LIMIT)) {
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
		if (candidate.length > MATTERMOST_TABLE_MAX_LENGTH) {
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

export function truncateMattermostMarkdown(markdown: string, maxLength = MATTERMOST_POST_MAX_LENGTH): string {
	if (markdown.length <= maxLength) {
		return markdown;
	}
	const notice = '\n\n_Response truncated. Open the full result in nao._';
	const available = Math.max(maxLength - notice.length, 0);
	const prefix = markdown.slice(0, available);
	const lastLineBreak = prefix.lastIndexOf('\n');
	const safePrefix = prefix.slice(0, lastLineBreak > 0 ? lastLineBreak : available).trimEnd();
	return `${safePrefix}${notice}`.slice(0, maxLength);
}

export function resolveMattermostThreadId(
	adapter: MattermostAdapter,
	post: MattermostPostPlacement,
	isDirectMessage: boolean,
): string {
	const rootPostId = isDirectMessage && !post.root_id ? undefined : post.root_id || post.id;
	return adapter.encodeThreadId({ channelId: post.channel_id, rootPostId });
}

export async function resolveMattermostAccount<T>(input: {
	userId: string;
	emailCache: MattermostEmailCache;
	fetchEmail: () => Promise<string | null>;
	findUser: (email: string) => Promise<T | null>;
	now?: () => number;
}): Promise<T | null> {
	const cachedEntry = input.emailCache.get(input.userId);
	if (cachedEntry && cachedEntry.expiresAt > (input.now ?? Date.now)()) {
		return cachedEntry.email ? input.findUser(cachedEntry.email) : null;
	}

	const email = await input.fetchEmail();
	cacheMattermostEmail(input.emailCache, input.userId, email, (input.now ?? Date.now)());
	if (!email) {
		return null;
	}
	const normalizedEmail = email.toLowerCase();
	return input.findUser(normalizedEmail);
}

export function cacheMattermostEmail(
	emailCache: MattermostEmailCache,
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

export async function fetchMattermostUserEmail(input: {
	baseUrl: string;
	botToken: string;
	userId: string;
	fetchImpl?: typeof fetch;
}): Promise<string | null> {
	const profile = await fetchMattermostUserProfile(input);
	return profile?.email ?? null;
}

export async function fetchMattermostUserProfile(input: {
	baseUrl: string;
	botToken: string;
	userId: string;
	fetchImpl?: typeof fetch;
}): Promise<{ email: string | null; isBot: boolean } | null> {
	const url = new URL(input.baseUrl);
	const basePath = url.pathname.replace(/\/$/, '');
	url.pathname = `${basePath}/api/v4/users/${encodeURIComponent(input.userId)}`;
	const response = await (input.fetchImpl ?? fetch)(url, {
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${input.botToken}`,
		},
	});
	if (!response.ok) {
		return null;
	}
	const user = (await response.json()) as { email?: unknown; is_bot?: unknown };
	return {
		email: typeof user.email === 'string' && user.email.trim() ? user.email.trim() : null,
		isBot: user.is_bot === true,
	};
}

const MATTERMOST_TABLE_COLUMN_LIMIT = 20;
const MATTERMOST_TABLE_CELL_LIMIT = 160;
const MATTERMOST_TABLE_MAX_LENGTH = 12_000;
const MISSING_EMAIL_CACHE_TTL_MS = 5 * 60 * 1000;

function extractMentionTokens(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === 'string');
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) {
			return [];
		}
		if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
			try {
				return extractMentionTokens(JSON.parse(trimmed));
			} catch {
				return [];
			}
		}
		return trimmed.split(/[\s,]+/).filter(Boolean);
	}
	if (value && typeof value === 'object') {
		return Object.keys(value);
	}
	return [];
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createMattermostPostPatchUrl(baseUrl: string, postId: string): URL {
	const url = createMattermostPostUrl(baseUrl, postId);
	url.pathname = `${url.pathname}/patch`;
	return url;
}

function createMattermostPostUrl(baseUrl: string, postId: string): URL {
	return createMattermostApiUrl(baseUrl, `posts/${encodeURIComponent(postId)}`);
}

function createMattermostApiUrl(baseUrl: string, path: string): URL {
	const url = new URL(baseUrl);
	const basePath = url.pathname.replace(/\/$/, '');
	url.pathname = `${basePath}/api/v4/${path}`;
	return url;
}

function isMattermostUser(value: unknown): value is { id: string } {
	return (
		Boolean(value) &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		typeof (value as { id?: unknown }).id === 'string' &&
		Boolean((value as { id: string }).id.trim())
	);
}

function createMattermostFeedbackSignature(projectId: string, postId: string, assistantMessageId: string): string {
	const payload = JSON.stringify(['mattermost_feedback', 1, projectId, postId, assistantMessageId]);
	return createHmac('sha256', env.BETTER_AUTH_SECRET).update(payload).digest('base64url');
}

function timingSafeStringEqual(expected: string, candidate: string): boolean {
	const expectedBuffer = Buffer.from(expected);
	const candidateBuffer = Buffer.from(candidate);
	return expectedBuffer.length === candidateBuffer.length && timingSafeEqual(expectedBuffer, candidateBuffer);
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
	const truncated =
		text.length > MATTERMOST_TABLE_CELL_LIMIT ? `${text.slice(0, MATTERMOST_TABLE_CELL_LIMIT - 1)}…` : text;
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
