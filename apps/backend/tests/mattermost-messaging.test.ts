import { createMattermostAdapter } from 'chat-adapter-mattermost';
import { describe, expect, it, vi } from 'vitest';

import { generateChartImage } from '../src/components/generate-chart';
import { createMattermostActionSecret, verifyMattermostActionSecret } from '../src/utils/mattermost-action-secret';
import { createMattermostCallbackResponse, MATTERMOST_CALLBACK_CONTENT_TYPE } from '../src/utils/mattermost-callback';
import { getMattermostLoginCommandForUnlinkedUser, parseMattermostLoginCommand } from '../src/utils/mattermost-login';
import { resolveMattermostReactionFeedback } from '../src/utils/mattermost-reaction';
import { shouldHandleMattermostMessage } from '../src/utils/mattermost-reply';
import { resolveMattermostSqlOutput } from '../src/utils/mattermost-sql-output';
import {
	buildMattermostAnswerPatchBody,
	createMattermostStopAttachment,
	getMattermostPostBaseProps,
	patchMattermostAnswerPost,
} from '../src/utils/mattermost-stop-action';
import {
	createMattermostMarkdownTable,
	MATTERMOST_TABLE_ROW_LIMIT,
	truncateMattermostMarkdown,
} from '../src/utils/mattermost-table';
import { resolveMattermostThreadId } from '../src/utils/mattermost-thread';
import {
	cacheMattermostEmail,
	type MattermostEmailCacheEntry,
	resolveMattermostAccount,
} from '../src/utils/mattermost-user';
import {
	createMattermostAnswerMessage,
	getMessagingProviderWebhookUrl,
	resolveMattermostCallbackBaseUrl,
} from '../src/utils/messaging-provider';

vi.mock('../src/queries/project.queries', () => ({}));
vi.mock('../src/utils/logger', () => ({
	logger: {
		error: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
	},
}));

describe('parseMattermostLoginCommand', () => {
	it('parses a bare login command', () => {
		expect(parseMattermostLoginCommand('login abc-123')).toEqual({ code: 'abc-123' });
		expect(parseMattermostLoginCommand('  LoGiN   abc-123  ')).toEqual({ code: 'abc-123' });
	});

	it('tolerates slash-prefixed login commands', () => {
		expect(parseMattermostLoginCommand('/login abc-123')).toEqual({ code: 'abc-123' });
		expect(parseMattermostLoginCommand(' /login   abc-123 ')).toEqual({ code: 'abc-123' });
	});

	it('does not treat ordinary messages as login commands', () => {
		expect(parseMattermostLoginCommand('please login abc-123')).toBeNull();
		expect(parseMattermostLoginCommand('logins abc-123')).toBeNull();
	});
});

describe('getMattermostLoginCommandForUnlinkedUser', () => {
	it('returns login commands for unlinked authors', () => {
		expect(getMattermostLoginCommandForUnlinkedUser('login abc-123', false)).toEqual({ code: 'abc-123' });
	});

	it('ignores login-like messages from linked authors', () => {
		expect(getMattermostLoginCommandForUnlinkedUser('login abc-123', true)).toBeNull();
		expect(getMattermostLoginCommandForUnlinkedUser('login is broken for everyone', true)).toBeNull();
	});
});

describe('resolveMattermostThreadId', () => {
	const adapter = createMattermostAdapter({
		baseUrl: 'https://mattermost.example',
		botToken: 'test-token',
	});
	const channelId = 'channel-1';

	it('uses the channel-level ID for a top-level direct message', () => {
		const threadId = resolveMattermostThreadId(adapter, { id: 'post-1', channel_id: channelId }, true);
		const followUpThreadId = resolveMattermostThreadId(adapter, { id: 'post-2', channel_id: channelId }, true);

		expect(adapter.decodeThreadId(threadId)).toEqual({ channelId });
		expect(threadId.split(':')).toHaveLength(2);
		expect(followUpThreadId).toBe(threadId);
	});

	it('preserves an existing direct-message thread', () => {
		const threadId = resolveMattermostThreadId(
			adapter,
			{ id: 'post-2', channel_id: channelId, root_id: 'root-1' },
			true,
		);

		expect(adapter.decodeThreadId(threadId)).toEqual({ channelId, rootPostId: 'root-1' });
	});

	it('anchors a top-level channel message on its post', () => {
		const threadId = resolveMattermostThreadId(adapter, { id: 'post-3', channel_id: channelId }, false);

		expect(adapter.decodeThreadId(threadId)).toEqual({ channelId, rootPostId: 'post-3' });
	});

	it('preserves an existing channel thread', () => {
		const threadId = resolveMattermostThreadId(
			adapter,
			{ id: 'post-4', channel_id: channelId, root_id: 'root-2' },
			false,
		);

		expect(adapter.decodeThreadId(threadId)).toEqual({ channelId, rootPostId: 'root-2' });
	});
});

describe('shouldHandleMattermostMessage', () => {
	const baseInput = {
		isDirectMessage: false,
		isMention: false,
		hasExistingChat: false,
		authorType: 'human',
		isOwnMessage: false,
	} as const;

	it('handles direct messages without a mention', () => {
		expect(shouldHandleMattermostMessage({ ...baseInput, isDirectMessage: true })).toBe(true);
	});

	it('ignores new channel messages without a mention', () => {
		expect(shouldHandleMattermostMessage(baseInput)).toBe(false);
	});

	it('handles channel mentions', () => {
		expect(shouldHandleMattermostMessage({ ...baseInput, isMention: true })).toBe(true);
	});

	it('handles channel follow-ups with an existing chat', () => {
		expect(shouldHandleMattermostMessage({ ...baseInput, hasExistingChat: true })).toBe(true);
	});

	it('ignores the bot own messages and messages from other bots', () => {
		expect(shouldHandleMattermostMessage({ ...baseInput, isOwnMessage: true })).toBe(false);
		expect(shouldHandleMattermostMessage({ ...baseInput, authorType: 'bot' })).toBe(false);
	});

	it('handles direct messages from an unknown author', () => {
		expect(
			shouldHandleMattermostMessage({
				...baseInput,
				authorType: 'unknown',
				isDirectMessage: true,
			}),
		).toBe(true);
	});

	it('ignores unmentioned thread follow-ups from an unknown author', () => {
		expect(
			shouldHandleMattermostMessage({
				...baseInput,
				authorType: 'unknown',
				hasExistingChat: true,
			}),
		).toBe(false);
	});
});

describe('Mattermost answer rendering', () => {
	it('builds and clears the Stop attachment', () => {
		const callbackUrl = 'https://nao.example/api/webhooks/mattermost/project';
		const token = 'callback-token';
		const attachment = createMattermostStopAttachment(callbackUrl, token);
		const baseProps = getMattermostPostBaseProps({
			id: 'post-1',
			props: { from_bot: 'true', existing: true },
		});
		const streaming = buildMattermostAnswerPatchBody('Partial answer', baseProps, [attachment]);
		const cleared = buildMattermostAnswerPatchBody('Final answer', baseProps, []);

		expect(streaming).toEqual({
			message: 'Partial answer',
			props: {
				from_bot: 'true',
				existing: true,
				attachments: [
					{
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
					},
				],
			},
		});
		expect(cleared).toEqual({
			message: 'Final answer',
			props: {
				from_bot: 'true',
				existing: true,
				attachments: [],
			},
		});
	});

	it('patches the post without reading it first', async () => {
		const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
		await patchMattermostAnswerPost({
			baseUrl: 'https://mattermost.example/base/',
			botToken: 'token',
			postId: 'post-1',
			message: 'Streaming answer',
			baseProps: { from_bot: 'true' },
			attachments: [createMattermostStopAttachment('https://nao.example/callback', 'callback-token')],
			fetchImpl,
		});

		expect(fetchImpl).toHaveBeenCalledOnce();
		expect(fetchImpl).toHaveBeenCalledWith(
			new URL('https://mattermost.example/base/api/v4/posts/post-1/patch'),
			expect.objectContaining({
				method: 'PUT',
				body: expect.stringContaining('"integration":{"url":"https://nao.example/callback"'),
			}),
		);
	});

	it('keeps the answer and link in markdown without a card', () => {
		const message = createMattermostAnswerMessage('Answer text', 'https://nao.example/chat-1');

		expect(message).toEqual({
			markdown: 'Answer text\n\n**[Open in nao](https://nao.example/chat-1)**',
		});
		expect(createMattermostAnswerMessage('', 'https://nao.example/chat-1')).toEqual({
			markdown: '**[Open in nao](https://nao.example/chat-1)**',
		});
		expect(message).not.toHaveProperty('card');
		expect(message).not.toHaveProperty('attachments');
	});
});

describe('createMattermostMarkdownTable', () => {
	it('renders table headers, separators, and rows', () => {
		expect(
			createMattermostMarkdownTable({
				title: 'Top customers',
				rows: [{ customer: 'Acme', total: 42 }],
			}),
		).toBe('**Top customers**\n\n| customer | total |\n| --- | --- |\n| Acme | 42 |');
	});

	it('escapes pipes and newlines inside cells', () => {
		expect(
			createMattermostMarkdownTable({
				title: 'Values',
				rows: [{ value: 'first|second\nthird' }],
			}),
		).toContain('| first\\|second<br>third |');
	});

	it('caps rows and reports the omitted count', () => {
		const rows = Array.from({ length: MATTERMOST_TABLE_ROW_LIMIT + 3 }, (_, index) => ({ row: index + 1 }));
		const table = createMattermostMarkdownTable({ title: 'Rows', rows });

		expect(table).toContain('_3 rows omitted. Open the full result in nao._');
		expect(table).toContain(`| ${MATTERMOST_TABLE_ROW_LIMIT} |`);
		expect(table).not.toContain(`| ${MATTERMOST_TABLE_ROW_LIMIT + 1} |`);
		expect(table).toContain(`| ${MATTERMOST_TABLE_ROW_LIMIT} |\n\n_3 rows omitted.`);
	});

	it('does not emit trailing whitespace on table lines', () => {
		const table = createMattermostMarkdownTable({
			title: 'Values',
			rows: [
				{ first: 'one', second: 'two' },
				{ first: 'three', second: 'four' },
			],
		});

		expect(table?.split('\n').every((line) => !/[ \t]+$/.test(line))).toBe(true);
	});

	it('returns null when rows are missing or empty', () => {
		expect(createMattermostMarkdownTable({ title: 'Empty', rows: undefined })).toBeNull();
		expect(createMattermostMarkdownTable({ title: 'Empty', rows: [] })).toBeNull();
	});

	it('truncates oversized markdown on a complete line with a visible note', () => {
		const markdown = Array.from({ length: 20 }, (_, index) => `Line ${index}`).join('\n');
		const truncated = truncateMattermostMarkdown(markdown, 100);

		expect(truncated.length).toBeLessThanOrEqual(100);
		expect(truncated).toContain('Response truncated. Open the full result in nao.');
	});
});

describe('Mattermost chart images', () => {
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

describe('resolveMattermostSqlOutput', () => {
	it('returns an in-stream result without loading persisted data', async () => {
		const sqlOutput = { name: 'Current', rows: [{ value: 1 }] };
		const loadPersisted = vi.fn(async () => null);
		const result = await resolveMattermostSqlOutput({
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
		const first = await resolveMattermostSqlOutput({ queryId: 'query-2', sqlOutputs, loadPersisted });
		const second = await resolveMattermostSqlOutput({ queryId: 'query-2', sqlOutputs, loadPersisted });

		expect(first).toBe(persisted);
		expect(second).toBe(persisted);
		expect(sqlOutputs.get('query-2')).toBe(persisted);
		expect(loadPersisted).toHaveBeenCalledOnce();
	});

	it('returns nothing when in-stream and persisted results are missing', async () => {
		await expect(
			resolveMattermostSqlOutput({
				queryId: 'missing',
				sqlOutputs: new Map(),
				loadPersisted: vi.fn(async () => null),
			}),
		).resolves.toBeUndefined();
	});

	it('returns nothing when the persisted lookup fails', async () => {
		await expect(
			resolveMattermostSqlOutput({
				queryId: 'failed',
				sqlOutputs: new Map(),
				loadPersisted: vi.fn(async () => {
					throw new Error('database unavailable');
				}),
			}),
		).resolves.toBeUndefined();
	});
});

describe('Mattermost reaction feedback', () => {
	it('maps added and removed feedback reactions', () => {
		expect(resolveMattermostReactionFeedback({ added: true, emojiName: 'thumbs_up', isBot: false })).toEqual({
			action: 'upsert',
			vote: 'up',
		});
		expect(resolveMattermostReactionFeedback({ added: false, emojiName: 'thumbs_down', isBot: false })).toEqual({
			action: 'delete',
			vote: 'down',
		});
	});

	it('ignores bot-authored and unrelated reactions', () => {
		expect(resolveMattermostReactionFeedback({ added: true, emojiName: 'thumbs_up', isBot: true })).toBeNull();
		expect(resolveMattermostReactionFeedback({ added: true, emojiName: 'heart', isBot: false })).toBeNull();
	});
});

describe('Mattermost account resolution', () => {
	it('matches a nao user from the Mattermost email and caches it', async () => {
		const emailCache = new Map<string, MattermostEmailCacheEntry>();
		const findUser = vi.fn(async (email: string) => ({ email }));
		const result = await resolveMattermostAccount({
			userId: 'mattermost-user',
			emailCache,
			fetchEmail: vi.fn(async () => 'User@Example.com'),
			findUser,
		});

		expect(result).toEqual({ email: 'user@example.com' });
		expect(emailCache.get('mattermost-user')).toEqual({
			email: 'user@example.com',
			expiresAt: Number.POSITIVE_INFINITY,
		});
		expect(findUser).toHaveBeenCalledWith('user@example.com');
	});

	it('falls back to the login command when no email is available', async () => {
		const findUser = vi.fn(async () => ({ email: 'unused@example.com' }));
		const result = await resolveMattermostAccount({
			userId: 'mattermost-user',
			emailCache: new Map(),
			fetchEmail: vi.fn(async () => null),
			findUser,
		});

		expect(result).toBeNull();
		expect(findUser).not.toHaveBeenCalled();
		expect(parseMattermostLoginCommand('login fallback-code')).toEqual({ code: 'fallback-code' });
	});

	it('caches a missing email', async () => {
		const currentTime = 10_000;
		const emailCache = new Map<string, MattermostEmailCacheEntry>();
		const fetchEmail = vi.fn(async () => null);
		const findUser = vi.fn(async (email: string) => ({ email }));
		const input = {
			userId: 'mattermost-user',
			emailCache,
			fetchEmail,
			findUser,
			now: () => currentTime,
		};

		expect(await resolveMattermostAccount(input)).toBeNull();
		expect(await resolveMattermostAccount(input)).toBeNull();

		expect(fetchEmail).toHaveBeenCalledTimes(1);
		expect(findUser).not.toHaveBeenCalled();
		expect(emailCache.get('mattermost-user')).toEqual({
			email: null,
			expiresAt: currentTime + 5 * 60 * 1000,
		});
	});

	it('retries email resolution when a cached miss expires', async () => {
		let currentTime = 10_000;
		const emailCache = new Map<string, MattermostEmailCacheEntry>();
		const fetchEmail = vi
			.fn<() => Promise<string | null>>()
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce('Recovered@Example.com');
		const findUser = vi.fn(async (email: string) => ({ email }));
		const input = {
			userId: 'mattermost-user',
			emailCache,
			fetchEmail,
			findUser,
			now: () => currentTime,
		};

		expect(await resolveMattermostAccount(input)).toBeNull();
		currentTime += 5 * 60 * 1000;
		expect(await resolveMattermostAccount(input)).toEqual({ email: 'recovered@example.com' });

		expect(fetchEmail).toHaveBeenCalledTimes(2);
		expect(emailCache.get('mattermost-user')).toEqual({
			email: 'recovered@example.com',
			expiresAt: Number.POSITIVE_INFINITY,
		});
	});

	it('uses a successful email cached after a miss', async () => {
		const currentTime = 10_000;
		const emailCache = new Map<string, MattermostEmailCacheEntry>();
		const fetchEmail = vi.fn(async () => null);
		const findUser = vi.fn(async (email: string) => ({ email }));
		const input = {
			userId: 'mattermost-user',
			emailCache,
			fetchEmail,
			findUser,
			now: () => currentTime,
		};

		expect(await resolveMattermostAccount(input)).toBeNull();
		cacheMattermostEmail(emailCache, 'mattermost-user', 'Manual@Example.com', currentTime);
		expect(await resolveMattermostAccount(input)).toEqual({ email: 'manual@example.com' });

		expect(fetchEmail).toHaveBeenCalledTimes(1);
		expect(emailCache.get('mattermost-user')).toEqual({
			email: 'manual@example.com',
			expiresAt: Number.POSITIVE_INFINITY,
		});
	});
});

describe('Mattermost callback URL', () => {
	it('prefers an explicit callback URL', () => {
		expect(resolveMattermostCallbackBaseUrl('https://callbacks.example', 'https://nao.example')).toBe(
			'https://callbacks.example',
		);
	});

	it('falls back to the browser URL', () => {
		expect(resolveMattermostCallbackBaseUrl('', 'https://nao.example')).toBe('https://nao.example');
	});

	it.each([
		['https://nao.example', 'https://nao.example/api/webhooks/mattermost/project-1'],
		['https://nao.example/', 'https://nao.example/api/webhooks/mattermost/project-1'],
		['https://nao.example/backend', 'https://nao.example/backend/api/webhooks/mattermost/project-1'],
		['https://nao.example/backend/', 'https://nao.example/backend/api/webhooks/mattermost/project-1'],
	])('builds the callback URL from %s', (baseUrl, expectedUrl) => {
		expect(getMessagingProviderWebhookUrl(baseUrl, 'mattermost', 'project-1')).toBe(expectedUrl);
	});

	it('encodes the provider and project ID', () => {
		expect(getMessagingProviderWebhookUrl('https://nao.example/backend', 'matter/most', 'project one')).toBe(
			'https://nao.example/backend/api/webhooks/matter%2Fmost/project%20one',
		);
	});

	it('does not include the action token in the callback URL', () => {
		const token = createMattermostActionSecret('project-1', 'post-1');
		const callbackUrl = getMessagingProviderWebhookUrl('https://nao.example', 'mattermost', 'project-1');

		expect(callbackUrl).toBe('https://nao.example/api/webhooks/mattermost/project-1');
		expect(callbackUrl).not.toContain(token);
	});
});

describe('Mattermost callback response', () => {
	it('returns JSON that Mattermost can parse', () => {
		expect(MATTERMOST_CALLBACK_CONTENT_TYPE).toBe('application/json');
		expect(JSON.stringify(createMattermostCallbackResponse())).toBe('{}');
	});
});

describe('Mattermost action secrets', () => {
	it('accepts only the secret derived for the callback project and post', () => {
		const secret = createMattermostActionSecret('project-1', 'post-1');
		expect(verifyMattermostActionSecret('project-1', 'post-1', secret)).toBe(true);
		expect(verifyMattermostActionSecret('project-2', 'post-1', secret)).toBe(false);
		expect(verifyMattermostActionSecret('project-1', 'post-2', secret)).toBe(false);
		expect(verifyMattermostActionSecret('project-1', 'post-1', 'invalid')).toBe(false);
	});
});
