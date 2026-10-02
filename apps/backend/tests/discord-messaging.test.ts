import { describe, expect, it, vi } from 'vitest';

import { generateChartImage } from '../src/components/generate-chart';
import {
	cacheDiscordEmail,
	canUseDiscordInProject,
	createDiscordAnswerAttachment,
	createDiscordMarkdownTable,
	DISCORD_ATTACHMENT_NOTICE,
	DISCORD_OVERFLOW_FILENAME,
	DISCORD_POST_MAX_LENGTH,
	DISCORD_TABLE_ROW_LIMIT,
	type DiscordEmailCacheEntry,
	getDiscordLoginCommandForUnlinkedUser,
	hasExplicitDiscordMention,
	parseDiscordLoginCommand,
	resolveDiscordAccount,
	resolveDiscordReactionFeedback,
	resolveDiscordSqlOutput,
	shouldHandleDiscordMessage,
	truncateDiscordMarkdown,
	validateDiscordConnection,
} from '../src/services/discord-helpers';
import { createDiscordAnswerMessage, getMessagingProviderWebhookUrl } from '../src/utils/messaging-provider';

vi.mock('../src/queries/project.queries', () => ({}));
vi.mock('../src/utils/logger', () => ({
	logger: {
		error: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
	},
}));

describe('canUseDiscordInProject', () => {
	// Gates both every inbound message and the links/fallback a settings save accepts, so widening
	// or narrowing it changes who the bot answers for.
	it.each(['admin', 'user', 'context_admin'] as const)('answers for %s', (role) => {
		expect(canUseDiscordInProject(role)).toBe(true);
	});

	it.each(['viewer', null, undefined] as const)('refuses %s', (role) => {
		expect(canUseDiscordInProject(role)).toBe(false);
	});
});

describe('validateDiscordConnection', () => {
	it('accepts a valid Discord bot user response', async () => {
		const fetchImpl = vi.fn(async () => Response.json({ id: 'bot-user-id', username: 'nao' }));

		await expect(
			validateDiscordConnection({
				botToken: 'test-token',
				fetchImpl,
			}),
		).resolves.toBeUndefined();

		expect(fetchImpl).toHaveBeenCalledWith(
			'https://discord.com/api/v10/users/@me',
			expect.objectContaining({
				headers: expect.objectContaining({
					Accept: 'application/json',
					Authorization: 'Bot test-token',
				}),
			}),
		);
	});

	it('honors a custom API base URL', async () => {
		const fetchImpl = vi.fn(async () => Response.json({ id: 'bot-user-id' }));

		await validateDiscordConnection({
			botToken: 'test-token',
			apiUrl: 'https://discord.example/api/v10',
			fetchImpl,
		});

		expect(fetchImpl).toHaveBeenCalledWith('https://discord.example/api/v10/users/@me', expect.anything());
	});

	it.each([401, 403])('reports rejected bot tokens for HTTP %s', async (status) => {
		const fetchImpl = vi.fn(async () => new Response(null, { status }));

		await expect(
			validateDiscordConnection({
				botToken: 'test-token',
				fetchImpl,
			}),
		).rejects.toThrow('Discord rejected the bot token. Check the token and try again.');
	});

	it('reports other failed responses with the status code', async () => {
		const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));

		await expect(
			validateDiscordConnection({
				botToken: 'test-token',
				fetchImpl,
			}),
		).rejects.toThrow('Discord connection failed (HTTP 500).');
	});

	it('reports network failures without exposing provider details', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('connect ECONNREFUSED secret-host'));

		await expect(
			validateDiscordConnection({
				botToken: 'test-token',
				fetchImpl,
			}),
		).rejects.toMatchObject({
			message: 'Could not reach the Discord API. Check your network and try again.',
		});
	});

	it.each([{}, { id: '' }, { id: 42 }])('rejects malformed successful responses', async (body) => {
		const fetchImpl = vi.fn(async () => Response.json(body));

		await expect(
			validateDiscordConnection({
				botToken: 'test-token',
				fetchImpl,
			}),
		).rejects.toThrow('Discord returned an unexpected response.');
	});
});

describe('parseDiscordLoginCommand', () => {
	it('parses a bare login command', () => {
		expect(parseDiscordLoginCommand('login abc-1234')).toEqual({ code: 'abc-1234' });
		expect(parseDiscordLoginCommand('  LoGiN   ABC-1234  ')).toEqual({ code: 'abc-1234' });
	});

	it('tolerates slash-prefixed login commands', () => {
		expect(parseDiscordLoginCommand('/login abc-1234')).toEqual({ code: 'abc-1234' });
		expect(parseDiscordLoginCommand(' /login   ABC-1234 ')).toEqual({ code: 'abc-1234' });
	});

	it('accepts linking codes with hyphens and underscores', () => {
		expect(parseDiscordLoginCommand('login ab-c_123')).toEqual({ code: 'ab-c_123' });
	});

	it('does not treat ordinary messages as login commands', () => {
		expect(parseDiscordLoginCommand('login to the system is broken')).toBeNull();
		expect(parseDiscordLoginCommand('login is broken')).toBeNull();
		expect(parseDiscordLoginCommand('please login abc-1234')).toBeNull();
		expect(parseDiscordLoginCommand('logins abc-1234')).toBeNull();
	});

	it('rejects malformed, short, long, or extended linking codes', () => {
		expect(parseDiscordLoginCommand('login')).toBeNull();
		expect(parseDiscordLoginCommand('login abc-123')).toBeNull();
		expect(parseDiscordLoginCommand('login abc-12345')).toBeNull();
		expect(parseDiscordLoginCommand('login abc.1234')).toBeNull();
		expect(parseDiscordLoginCommand('login abc-1234 extra')).toBeNull();
	});
});

describe('getDiscordLoginCommandForUnlinkedUser', () => {
	it('returns login commands for unlinked authors', () => {
		expect(getDiscordLoginCommandForUnlinkedUser('login ABC-1234', false)).toEqual({ code: 'abc-1234' });
	});

	it('ignores login-like messages from linked authors', () => {
		expect(getDiscordLoginCommandForUnlinkedUser('login abc-1234', true)).toBeNull();
		expect(getDiscordLoginCommandForUnlinkedUser('login is broken', true)).toBeNull();
	});
});

describe('hasExplicitDiscordMention', () => {
	const baseMessage = {
		id: 'message-1',
		channel_id: 'channel-1',
		content: 'hello',
	};

	it('detects a direct user mention of the bot', () => {
		expect(
			hasExplicitDiscordMention(
				{ ...baseMessage, content: 'hey <@1234567890> can you help' },
				{ userId: '1234567890' },
			),
		).toBe(true);
		expect(
			hasExplicitDiscordMention({ ...baseMessage, content: '<@!1234567890> ping' }, { userId: '1234567890' }),
		).toBe(true);
	});

	it('detects a mention of a configured trigger role', () => {
		expect(
			hasExplicitDiscordMention(
				{ ...baseMessage, content: '<@&9876543210> are you there' },
				{ userId: '1234567890', mentionRoleIds: ['9876543210'] },
			),
		).toBe(true);
	});

	it('ignores unrelated mentions and missing content', () => {
		expect(
			hasExplicitDiscordMention({ ...baseMessage, content: 'hello <@5555555555>' }, { userId: '1234567890' }),
		).toBe(false);
		expect(
			hasExplicitDiscordMention(
				{ ...baseMessage, content: '<@&4444444444>' },
				{ userId: '1234567890', mentionRoleIds: ['9876543210'] },
			),
		).toBe(false);
		expect(hasExplicitDiscordMention(baseMessage, { userId: '1234567890' })).toBe(false);
		expect(hasExplicitDiscordMention(undefined, { userId: '1234567890' })).toBe(false);
	});
});

describe('shouldHandleDiscordMessage', () => {
	const baseInput = {
		isDirectMessage: false,
		isThreadReply: false,
		isMention: false,
		hasExistingChat: false,
		authorType: 'human',
		isOwnMessage: false,
	} as const;

	it('handles top-level direct messages without a mention', () => {
		expect(shouldHandleDiscordMessage({ ...baseInput, isDirectMessage: true })).toBe(true);
	});

	it('ignores unrelated direct-message thread replies', () => {
		expect(
			shouldHandleDiscordMessage({
				...baseInput,
				isDirectMessage: true,
				isThreadReply: true,
			}),
		).toBe(false);
	});

	it('requires a mention before handling a new direct-message thread rooted on a nao answer', () => {
		expect(
			shouldHandleDiscordMessage({
				...baseInput,
				isDirectMessage: true,
				isThreadReply: true,
			}),
		).toBe(false);
		expect(
			shouldHandleDiscordMessage({
				...baseInput,
				isDirectMessage: true,
				isThreadReply: true,
				isMention: true,
			}),
		).toBe(true);
	});

	it('handles direct-message threads with an exact existing chat', () => {
		expect(
			shouldHandleDiscordMessage({
				...baseInput,
				isDirectMessage: true,
				isThreadReply: true,
				hasExistingChat: true,
			}),
		).toBe(true);
	});

	it('handles mentioned direct-message thread replies', () => {
		expect(
			shouldHandleDiscordMessage({
				...baseInput,
				isDirectMessage: true,
				isThreadReply: true,
				isMention: true,
			}),
		).toBe(true);
	});

	it('keeps channel mention and follow-up behavior', () => {
		expect(shouldHandleDiscordMessage(baseInput)).toBe(false);
		expect(
			shouldHandleDiscordMessage({
				...baseInput,
				isThreadReply: true,
				isMention: true,
			}),
		).toBe(true);
		expect(
			shouldHandleDiscordMessage({
				...baseInput,
				isThreadReply: true,
				hasExistingChat: true,
			}),
		).toBe(true);
	});

	it('ignores the bot own messages and messages from other bots', () => {
		const mentionedDirectThread = {
			...baseInput,
			isDirectMessage: true,
			isThreadReply: true,
			isMention: true,
		};
		expect(shouldHandleDiscordMessage({ ...mentionedDirectThread, isOwnMessage: true })).toBe(false);
		expect(shouldHandleDiscordMessage({ ...mentionedDirectThread, authorType: 'bot' })).toBe(false);
	});

	it('handles top-level direct messages and mentions from an unknown author', () => {
		expect(
			shouldHandleDiscordMessage({
				...baseInput,
				authorType: 'unknown',
				isDirectMessage: true,
			}),
		).toBe(true);
		expect(
			shouldHandleDiscordMessage({
				...baseInput,
				authorType: 'unknown',
				isThreadReply: true,
				isMention: true,
			}),
		).toBe(true);
		expect(
			shouldHandleDiscordMessage({
				...baseInput,
				authorType: 'unknown',
				isDirectMessage: true,
				isThreadReply: true,
				isMention: true,
			}),
		).toBe(true);
	});

	it('does not let an unknown author activate an unmentioned direct-message thread', () => {
		expect(
			shouldHandleDiscordMessage({
				...baseInput,
				authorType: 'unknown',
				isDirectMessage: true,
				isThreadReply: true,
				hasExistingChat: true,
			}),
		).toBe(false);
	});
});

describe('Discord answer rendering', () => {
	it('keeps the answer and link in markdown without a card', () => {
		const message = createDiscordAnswerMessage('Answer text', 'https://nao.example/chat-1');

		expect(message).toEqual({
			markdown: 'Answer text\n\n**[Open in nao](https://nao.example/chat-1)**',
		});
		expect(createDiscordAnswerMessage('', 'https://nao.example/chat-1')).toEqual({
			markdown: '**[Open in nao](https://nao.example/chat-1)**',
		});
		expect(message).not.toHaveProperty('card');
		expect(message).not.toHaveProperty('attachments');
	});

	it('leaves the markdown untouched when there is no chat link', () => {
		expect(createDiscordAnswerMessage('Answer text')).toEqual({ markdown: 'Answer text' });
	});
});

describe('createDiscordMarkdownTable', () => {
	it('renders table headers, separators, and rows', () => {
		expect(
			createDiscordMarkdownTable({
				title: 'Top customers',
				rows: [{ customer: 'Acme', total: 42 }],
			}),
		).toBe('**Top customers**\n\n| customer | total |\n| --- | --- |\n| Acme | 42 |');
	});

	it('escapes pipes and newlines inside cells', () => {
		expect(
			createDiscordMarkdownTable({
				title: 'Values',
				rows: [{ value: 'first|second\nthird' }],
			}),
		).toContain('| first\\|second<br>third |');
	});

	it('caps rows and reports the omitted count', () => {
		const rows = Array.from({ length: DISCORD_TABLE_ROW_LIMIT + 3 }, (_, index) => ({ row: index + 1 }));
		const table = createDiscordMarkdownTable({ title: 'Rows', rows });

		expect(table).toContain('_3 rows omitted. Open the full result in nao._');
		expect(table).toContain(`| ${DISCORD_TABLE_ROW_LIMIT} |`);
		expect(table).not.toContain(`| ${DISCORD_TABLE_ROW_LIMIT + 1} |`);
		expect(table).toContain(`| ${DISCORD_TABLE_ROW_LIMIT} |\n\n_3 rows omitted.`);
	});

	it('does not emit trailing whitespace on table lines', () => {
		const table = createDiscordMarkdownTable({
			title: 'Values',
			rows: [
				{ first: 'one', second: 'two' },
				{ first: 'three', second: 'four' },
			],
		});

		expect(table?.split('\n').every((line) => !/[ \t]+$/.test(line))).toBe(true);
	});

	it('returns null when rows are missing or empty', () => {
		expect(createDiscordMarkdownTable({ title: 'Empty', rows: undefined })).toBeNull();
		expect(createDiscordMarkdownTable({ title: 'Empty', rows: [] })).toBeNull();
	});

	it('truncates oversized markdown on a complete line with a visible note', () => {
		const markdown = Array.from({ length: 20 }, (_, index) => `Line ${index}`).join('\n');
		const truncated = truncateDiscordMarkdown(markdown, 100);

		expect(truncated.length).toBeLessThanOrEqual(100);
		expect(truncated).toContain('Response truncated. Open the full result in nao.');
	});

	it('uploads the answer only when it did not fit one post', () => {
		expect(createDiscordAnswerAttachment('x'.repeat(DISCORD_POST_MAX_LENGTH))).toBeNull();

		const body = 'x'.repeat(DISCORD_POST_MAX_LENGTH + 1);
		const attachment = createDiscordAnswerAttachment(body);

		expect(attachment?.filename).toBe(DISCORD_OVERFLOW_FILENAME);
		expect(attachment?.mimeType).toBe('text/markdown');
		expect(attachment?.data.toString('utf8')).toBe(body);
	});

	it('points at the attachment, not nao, when the answer was uploaded', () => {
		const truncated = truncateDiscordMarkdown('A line of output\n'.repeat(200), 100, DISCORD_ATTACHMENT_NOTICE);

		expect(truncated.length).toBeLessThanOrEqual(100);
		expect(truncated).toContain('The full answer is attached below.');
		expect(truncated).not.toContain('Open the full result in nao');
	});
});

describe('Discord chart images', () => {
	it('renders date-axis charts from persisted ISO date strings', () => {
		const image = generateChartImage({
			config: {
				chart_type: 'line',
				x_axis_key: 'month',
				x_axis_type: 'date',
				series: [
					{
						data_key: 'revenue',
						label: 'Revenue',
						value_format: { d3_format: ',.2f', compact: 'financial', prefix: '$' },
					},
				],
				title: 'Monthly Revenue Trend',
			},
			data: [
				{ month: '2018-01-01T00:00:00', orders: 213, revenue: 3641.37, avg_order_value: 17.1 },
				{ month: '2018-02-01T00:00:00', orders: 185, revenue: 3210.5, avg_order_value: 17.35 },
				{ month: '2018-03-01T00:00:00', orders: 220, revenue: 4012.75, avg_order_value: 18.24 },
			],
		});

		expect(image.byteLength).toBeGreaterThan(0);
	});
});

describe('resolveDiscordSqlOutput', () => {
	it('returns an in-stream result without loading persisted data', async () => {
		const sqlOutput = { name: 'Current', rows: [{ value: 1 }] };
		const loadPersisted = vi.fn(async () => null);
		const result = await resolveDiscordSqlOutput({
			queryId: 'query-1',
			sqlOutputs: new Map([['query-1', sqlOutput]]),
			loadPersisted,
		});

		expect(result).toBe(sqlOutput);
		expect(loadPersisted).not.toHaveBeenCalled();
	});

	it('loads and caches a persisted result after an in-stream miss', async () => {
		const persisted = { name: 'Persisted', rows: [{ value: 2 }] };
		const sqlOutputs = new Map();
		const loadPersisted = vi.fn(async () => persisted);
		const first = await resolveDiscordSqlOutput({ queryId: 'query-2', sqlOutputs, loadPersisted });
		const second = await resolveDiscordSqlOutput({ queryId: 'query-2', sqlOutputs, loadPersisted });

		expect(first).toBe(persisted);
		expect(second).toBe(persisted);
		expect(sqlOutputs.get('query-2')).toBe(persisted);
		expect(loadPersisted).toHaveBeenCalledOnce();
	});

	it('returns nothing when in-stream and persisted results are missing', async () => {
		await expect(
			resolveDiscordSqlOutput({
				queryId: 'missing',
				sqlOutputs: new Map(),
				loadPersisted: vi.fn(async () => null),
			}),
		).resolves.toBeUndefined();
	});

	it('returns nothing when the persisted lookup fails', async () => {
		await expect(
			resolveDiscordSqlOutput({
				queryId: 'failed',
				sqlOutputs: new Map(),
				loadPersisted: vi.fn(async () => {
					throw new Error('database unavailable');
				}),
			}),
		).resolves.toBeUndefined();
	});
});

describe('Discord reaction feedback', () => {
	it('maps added and removed feedback reactions', () => {
		expect(resolveDiscordReactionFeedback({ added: true, emojiName: 'thumbs_up', isBot: false })).toEqual({
			action: 'upsert',
			vote: 'up',
		});
		expect(resolveDiscordReactionFeedback({ added: false, emojiName: 'thumbs_down', isBot: false })).toEqual({
			action: 'delete',
			vote: 'down',
		});
	});

	it('recognizes the Discord thumbs emoji and +1/-1 aliases', () => {
		expect(resolveDiscordReactionFeedback({ added: true, emojiName: '👍', isBot: false })).toEqual({
			action: 'upsert',
			vote: 'up',
		});
		expect(resolveDiscordReactionFeedback({ added: true, emojiName: '-1', isBot: false })).toEqual({
			action: 'upsert',
			vote: 'down',
		});
	});

	it('ignores bot-authored and unrelated reactions', () => {
		expect(resolveDiscordReactionFeedback({ added: true, emojiName: 'thumbs_up', isBot: true })).toBeNull();
		expect(resolveDiscordReactionFeedback({ added: true, emojiName: 'heart', isBot: false })).toBeNull();
	});
});

describe('Discord account resolution', () => {
	it('matches a nao user from the Discord email and caches it', async () => {
		const emailCache = new Map<string, DiscordEmailCacheEntry>();
		const findUser = vi.fn(async (email: string) => ({ email }));
		const result = await resolveDiscordAccount({
			userId: 'discord-user',
			emailCache,
			fetchEmail: vi.fn(async () => 'User@Example.com'),
			findUser,
		});

		expect(result).toEqual({ email: 'user@example.com' });
		expect(emailCache.get('discord-user')).toEqual({
			email: 'user@example.com',
			expiresAt: Number.POSITIVE_INFINITY,
		});
		expect(findUser).toHaveBeenCalledWith('user@example.com');
	});

	it('falls back to the login command when no email is available', async () => {
		const findUser = vi.fn(async () => ({ email: 'unused@example.com' }));
		const result = await resolveDiscordAccount({
			userId: 'discord-user',
			emailCache: new Map(),
			fetchEmail: vi.fn(async () => null),
			findUser,
		});

		expect(result).toBeNull();
		expect(findUser).not.toHaveBeenCalled();
	});

	it('caches a missing email', async () => {
		const currentTime = 10_000;
		const emailCache = new Map<string, DiscordEmailCacheEntry>();
		const fetchEmail = vi.fn(async () => null);
		const findUser = vi.fn(async (email: string) => ({ email }));
		const input = {
			userId: 'discord-user',
			emailCache,
			fetchEmail,
			findUser,
			now: () => currentTime,
		};

		expect(await resolveDiscordAccount(input)).toBeNull();
		expect(await resolveDiscordAccount(input)).toBeNull();

		expect(fetchEmail).toHaveBeenCalledTimes(1);
		expect(findUser).not.toHaveBeenCalled();
		expect(emailCache.get('discord-user')).toEqual({
			email: null,
			expiresAt: currentTime + 5 * 60 * 1000,
		});
	});

	it('retries email resolution when a cached miss expires', async () => {
		let currentTime = 10_000;
		const emailCache = new Map<string, DiscordEmailCacheEntry>();
		const fetchEmail = vi
			.fn<() => Promise<string | null>>()
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce('Recovered@Example.com');
		const findUser = vi.fn(async (email: string) => ({ email }));
		const input = {
			userId: 'discord-user',
			emailCache,
			fetchEmail,
			findUser,
			now: () => currentTime,
		};

		expect(await resolveDiscordAccount(input)).toBeNull();
		currentTime += 5 * 60 * 1000;
		expect(await resolveDiscordAccount(input)).toEqual({ email: 'recovered@example.com' });

		expect(fetchEmail).toHaveBeenCalledTimes(2);
		expect(emailCache.get('discord-user')).toEqual({
			email: 'recovered@example.com',
			expiresAt: Number.POSITIVE_INFINITY,
		});
	});

	it('uses a successful email cached after a miss', async () => {
		const currentTime = 10_000;
		const emailCache = new Map<string, DiscordEmailCacheEntry>();
		const fetchEmail = vi.fn(async () => null);
		const findUser = vi.fn(async (email: string) => ({ email }));
		const input = {
			userId: 'discord-user',
			emailCache,
			fetchEmail,
			findUser,
			now: () => currentTime,
		};

		expect(await resolveDiscordAccount(input)).toBeNull();
		cacheDiscordEmail(emailCache, 'discord-user', 'Manual@Example.com', currentTime);
		expect(await resolveDiscordAccount(input)).toEqual({ email: 'manual@example.com' });

		expect(fetchEmail).toHaveBeenCalledTimes(1);
		expect(emailCache.get('discord-user')).toEqual({
			email: 'manual@example.com',
			expiresAt: Number.POSITIVE_INFINITY,
		});
	});
});

describe('Discord interaction webhook URL', () => {
	it.each([
		['https://nao.example', 'https://nao.example/api/webhooks/discord/project-1'],
		['https://nao.example/', 'https://nao.example/api/webhooks/discord/project-1'],
		['https://nao.example/backend', 'https://nao.example/backend/api/webhooks/discord/project-1'],
		['https://nao.example/backend/', 'https://nao.example/backend/api/webhooks/discord/project-1'],
	])('builds the interaction URL from %s', (baseUrl, expectedUrl) => {
		expect(getMessagingProviderWebhookUrl(baseUrl, 'discord', 'project-1')).toBe(expectedUrl);
	});

	it('encodes the provider and project ID', () => {
		expect(getMessagingProviderWebhookUrl('https://nao.example/backend', 'dis/cord', 'project one')).toBe(
			'https://nao.example/backend/api/webhooks/dis%2Fcord/project%20one',
		);
	});
});
