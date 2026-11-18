import { createMattermostAdapter } from 'chat-adapter-mattermost';
import { describe, expect, it, vi } from 'vitest';

import { renderChartToSvg } from '../../src/components/generate-chart';
import {
	buildMattermostAnswerPatchBody,
	cacheMattermostEmail,
	createMattermostActionSecret,
	createMattermostCallbackResponse,
	createMattermostFeedbackMetadata,
	createMattermostStopAttachment,
	fetchMattermostPost,
	getMattermostPostBaseProps,
	hasExplicitMattermostMention,
	MATTERMOST_CALLBACK_CONTENT_TYPE,
	MATTERMOST_FEEDBACK_PROP,
	type MattermostEmailCacheEntry,
	patchMattermostAnswerPost,
	resolveMattermostAccount,
	resolveMattermostReactionFeedback,
	resolveMattermostThreadId,
	validateMattermostConnection,
	verifyMattermostActionSecret,
	verifyMattermostFeedbackMetadata,
} from '../../src/services/mattermost-helpers';
import {
	createMarkdownTable,
	getLoginCommandForUnlinkedUser,
	MARKDOWN_TABLE_ROW_LIMIT,
	parseLoginCommand,
	resolveSqlOutput,
	shouldHandleMessage,
	truncateMarkdown,
} from '../../src/utils/markdown-messaging';
import {
	createMarkdownAnswerMessage,
	escapeMarkdownText,
	formatMessagingError,
	getMessagingProviderWebhookUrl,
	resolveMattermostCallbackBaseUrl,
} from '../../src/utils/messaging-provider';

vi.mock('../../src/queries/project.queries', () => ({}));
vi.mock('../../src/utils/logger', () => ({
	logger: {
		error: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
	},
}));

describe('formatMessagingError', () => {
	it.each([
		[
			'billing errors ending in punctuation',
			new Error('Ask an organization admin to update billing.'),
			'❌ An error occurred while processing your message. Ask an organization admin to update billing.',
		],
		[
			'errors without terminal punctuation',
			new Error('Unknown failure'),
			'❌ An error occurred while processing your message. Unknown failure.',
		],
	])('%s', (_description, error, expected) => {
		expect(formatMessagingError(error)).toBe(expected);
	});
});

describe('validateMattermostConnection', () => {
	it('accepts a valid Mattermost user response', async () => {
		const fetchImpl = vi.fn(async () => Response.json({ id: 'bot-user-id', username: 'nao' }));

		await expect(validateConnection(fetchImpl, 'https://mattermost.example/base/')).resolves.toBeUndefined();

		expect(fetchImpl).toHaveBeenCalledWith(
			new URL('https://mattermost.example/base/api/v4/users/me'),
			expect.objectContaining({
				headers: expect.objectContaining({
					Accept: 'application/json',
					Authorization: expect.any(String),
				}),
			}),
		);
	});

	it.each([401, 403])('reports rejected bot tokens for HTTP %s', async (status) => {
		await expect(validateConnection(vi.fn(async () => new Response(null, { status })))).rejects.toThrow(
			'Mattermost rejected the bot token. Check the token and try again.',
		);
	});

	it('reports when the server URL has no Mattermost API', async () => {
		await expect(validateConnection(vi.fn(async () => new Response(null, { status: 404 })))).rejects.toThrow(
			'No Mattermost API was found at this server URL.',
		);
	});

	it('reports network failures without exposing provider details', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('connect ECONNREFUSED secret-host'));

		await expect(validateConnection(fetchImpl)).rejects.toThrow(
			'Could not reach the Mattermost server. Check the server URL.',
		);
	});

	it.each([{}, { id: '' }, { id: 42 }])('rejects malformed successful responses', async (body) => {
		await expect(validateConnection(vi.fn(async () => Response.json(body)))).rejects.toThrow(
			'Mattermost returned an unexpected response.',
		);
	});

	function validateConnection(fetchImpl: typeof fetch, baseUrl = 'https://mattermost.example') {
		return validateMattermostConnection({ baseUrl, botToken: 'test-token', fetchImpl });
	}
});

describe('parseLoginCommand', () => {
	it('parses a bare login command', () => {
		expect(parseLoginCommand('login abc-1234')).toEqual({ code: 'abc-1234' });
		expect(parseLoginCommand('  LoGiN   ABC-1234  ')).toEqual({ code: 'abc-1234' });
	});

	it('tolerates slash-prefixed login commands', () => {
		expect(parseLoginCommand('/login abc-1234')).toEqual({ code: 'abc-1234' });
		expect(parseLoginCommand(' /login   ABC-1234 ')).toEqual({ code: 'abc-1234' });
	});

	it('accepts linking codes with hyphens and underscores', () => {
		expect(parseLoginCommand('login ab-c_123')).toEqual({ code: 'ab-c_123' });
	});

	it('does not treat ordinary messages as login commands', () => {
		expect(parseLoginCommand('login to the system is broken')).toBeNull();
		expect(parseLoginCommand('login is broken')).toBeNull();
		expect(parseLoginCommand('please login abc-1234')).toBeNull();
		expect(parseLoginCommand('logins abc-1234')).toBeNull();
	});

	it('rejects malformed, short, long, or extended linking codes', () => {
		expect(parseLoginCommand('login')).toBeNull();
		expect(parseLoginCommand('login abc-123')).toBeNull();
		expect(parseLoginCommand('login abc-12345')).toBeNull();
		expect(parseLoginCommand('login abc.1234')).toBeNull();
		expect(parseLoginCommand('login abc-1234 extra')).toBeNull();
	});
});

describe('getLoginCommandForUnlinkedUser', () => {
	it('returns login commands for unlinked authors', () => {
		expect(getLoginCommandForUnlinkedUser('login ABC-1234', false)).toEqual({ code: 'abc-1234' });
	});

	it('ignores login-like messages from linked authors', () => {
		expect(getLoginCommandForUnlinkedUser('login abc-1234', true)).toBeNull();
		expect(getLoginCommandForUnlinkedUser('login is broken', true)).toBeNull();
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

describe('hasExplicitMattermostMention', () => {
	const basePost = {
		id: 'post-1',
		channel_id: 'channel-1',
		message: 'hello',
	};

	it('detects the bot ID in Mattermost mention metadata', () => {
		expect(
			hasExplicitMattermostMention(
				{
					...basePost,
					props: { mentioned_user_ids: '["bot-user-id"]' },
				},
				{ userId: 'bot-user-id', userName: 'nao' },
			),
		).toBe(true);
	});

	it('detects the bot username in metadata and message text', () => {
		expect(
			hasExplicitMattermostMention(
				{
					...basePost,
					props: { mentions: ['nao'] },
				},
				{ userId: 'bot-user-id', userName: 'nao' },
			),
		).toBe(true);
		expect(
			hasExplicitMattermostMention(
				{ ...basePost, message: 'please help @nao' },
				{ userId: 'bot-user-id', userName: 'nao' },
			),
		).toBe(true);
	});

	it('does not infer a mention without raw Mattermost evidence', () => {
		expect(hasExplicitMattermostMention(basePost, { userId: 'bot-user-id', userName: 'nao' })).toBe(false);
	});
});

describe('shouldHandleMessage', () => {
	const baseInput = {
		isDirectMessage: false,
		isThreadReply: false,
		isMention: false,
		hasExistingChat: false,
		authorType: 'human',
		isOwnMessage: false,
	} as const;

	it('handles top-level direct messages without a mention', () => {
		expect(shouldHandleMessage({ ...baseInput, isDirectMessage: true })).toBe(true);
	});

	it('requires a mention before handling a new direct-message thread rooted on a nao answer', () => {
		expect(
			shouldHandleMessage({
				...baseInput,
				isDirectMessage: true,
				isThreadReply: true,
			}),
		).toBe(false);
		expect(
			shouldHandleMessage({
				...baseInput,
				isDirectMessage: true,
				isThreadReply: true,
				isMention: true,
			}),
		).toBe(true);
		expect(
			shouldHandleMessage({
				...baseInput,
				isDirectMessage: true,
				isThreadReply: true,
				hasExistingChat: true,
			}),
		).toBe(true);
	});

	it('keeps channel mention and follow-up behavior', () => {
		expect(shouldHandleMessage(baseInput)).toBe(false);
		expect(
			shouldHandleMessage({
				...baseInput,
				isThreadReply: true,
				isMention: true,
			}),
		).toBe(true);
		expect(
			shouldHandleMessage({
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
		expect(shouldHandleMessage({ ...mentionedDirectThread, isOwnMessage: true })).toBe(false);
		expect(shouldHandleMessage({ ...mentionedDirectThread, authorType: 'bot' })).toBe(false);
	});

	it('handles top-level direct messages and mentions from an unknown author', () => {
		expect(
			shouldHandleMessage({
				...baseInput,
				authorType: 'unknown',
				isDirectMessage: true,
			}),
		).toBe(true);
		expect(
			shouldHandleMessage({
				...baseInput,
				authorType: 'unknown',
				isThreadReply: true,
				isMention: true,
			}),
		).toBe(true);
		expect(
			shouldHandleMessage({
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
			shouldHandleMessage({
				...baseInput,
				authorType: 'unknown',
				isDirectMessage: true,
				isThreadReply: true,
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
		const feedbackMetadata = createMattermostFeedbackMetadata('project-1', 'post-1', 'message-1');
		const baseProps = getMattermostPostBaseProps({
			id: 'post-1',
			props: { from_bot: 'true', existing: true, [MATTERMOST_FEEDBACK_PROP]: feedbackMetadata },
		});
		const streaming = buildMattermostAnswerPatchBody('Partial answer', baseProps, [attachment]);
		const cleared = buildMattermostAnswerPatchBody('Final answer', baseProps, []);

		expect(streaming).toEqual({
			message: 'Partial answer',
			props: {
				from_bot: 'true',
				existing: true,
				[MATTERMOST_FEEDBACK_PROP]: feedbackMetadata,
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
				[MATTERMOST_FEEDBACK_PROP]: feedbackMetadata,
				attachments: [],
			},
		});
	});

	it('fetches a post and its props through the Mattermost API', async () => {
		const props = { [MATTERMOST_FEEDBACK_PROP]: { version: 1 } };
		const fetchImpl = vi.fn(async () =>
			Response.json({ id: 'post-1', channel_id: 'channel-1', message: 'Answer', props }),
		);

		await expect(
			fetchMattermostPost({
				baseUrl: 'https://mattermost.example/base/',
				botToken: 'token',
				postId: 'post-1',
				fetchImpl,
			}),
		).resolves.toEqual({
			id: 'post-1',
			channel_id: 'channel-1',
			message: 'Answer',
			props,
		});
		expect(fetchImpl).toHaveBeenCalledWith(
			new URL('https://mattermost.example/base/api/v4/posts/post-1'),
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer token' }),
			}),
		);
	});

	it('patches the post without reading it first', async () => {
		const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
		await patchAnswerPost({
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

	it('retries a rate-limited post patch', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(new Response(null, { status: 429 }))
			.mockResolvedValueOnce(new Response(null, { status: 200 }));
		const sleep = vi.fn(async () => undefined);

		await patchAnswerPost({ fetchImpl, sleep });

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledOnce();
	});

	it('uses the Mattermost rate-limit reset delay', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'X-Ratelimit-Reset': '1' } }))
			.mockResolvedValueOnce(new Response(null, { status: 200 }));
		const sleep = vi.fn(async () => undefined);

		await patchAnswerPost({ fetchImpl, sleep });

		expect(sleep).toHaveBeenCalledWith(1000);
	});

	it('throws after exhausting post patch rate-limit retries', async () => {
		const fetchImpl = vi.fn(async () => new Response(null, { status: 429 }));
		const sleep = vi.fn(async () => undefined);

		await expect(patchAnswerPost({ fetchImpl, sleep })).rejects.toThrow(
			'Mattermost post patch failed with status 429',
		);
		expect(fetchImpl).toHaveBeenCalledTimes(4);
		expect(sleep).toHaveBeenCalledTimes(3);
	});

	it('does not retry other post patch failures', async () => {
		const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));
		const sleep = vi.fn(async () => undefined);

		await expect(patchAnswerPost({ fetchImpl, sleep })).rejects.toThrow(
			'Mattermost post patch failed with status 500',
		);
		expect(fetchImpl).toHaveBeenCalledOnce();
		expect(sleep).not.toHaveBeenCalled();
	});

	it('keeps the answer and link in markdown without a card', () => {
		const message = createMarkdownAnswerMessage('Answer text', 'https://nao.example/chat-1');

		expect(message).toEqual({
			markdown: 'Answer text\n\n**[Open in nao](https://nao.example/chat-1)**',
		});
		expect(createMarkdownAnswerMessage('', 'https://nao.example/chat-1')).toEqual({
			markdown: '**[Open in nao](https://nao.example/chat-1)**',
		});
		expect(message).not.toHaveProperty('card');
		expect(message).not.toHaveProperty('attachments');
	});

	it('labels the link with the white-label app name', () => {
		expect(createMarkdownAnswerMessage('Answer text', 'https://nao.example/chat-1', 'Fibi')).toEqual({
			markdown: 'Answer text\n\n**[Open in Fibi](https://nao.example/chat-1)**',
		});
	});

	it('escapes markdown punctuation in the app name so it cannot break the link', () => {
		const { markdown } = createMarkdownAnswerMessage(
			'',
			'https://nao.example/chat-1',
			'yolo](https://evil.example)',
		);

		expect(markdown).toBe('**[Open in yolo\\]\\(https://evil.example\\)](https://nao.example/chat-1)**');
		expect(escapeMarkdownText('Data_Hub *beta*')).toBe('Data\\_Hub \\*beta\\*');
	});

	function patchAnswerPost(input: Partial<Parameters<typeof patchMattermostAnswerPost>[0]>) {
		return patchMattermostAnswerPost({
			baseUrl: 'https://mattermost.example/base/',
			botToken: 'token',
			postId: 'post-1',
			message: 'Streaming answer',
			baseProps: {},
			attachments: [],
			...input,
		});
	}
});

describe('createMarkdownTable', () => {
	it('renders table headers, separators, and rows', () => {
		expect(
			createMarkdownTable({
				title: 'Top customers',
				rows: [{ customer: 'Acme', total: 42 }],
			}),
		).toBe('**Top customers**\n\n| customer | total |\n| --- | --- |\n| Acme | 42 |');
	});

	it('escapes pipes and newlines inside cells', () => {
		expect(
			createMarkdownTable({
				title: 'Values',
				rows: [{ value: 'first|second\nthird' }],
			}),
		).toContain('| first\\|second<br>third |');
	});

	it('caps rows and reports the omitted count', () => {
		const rows = Array.from({ length: MARKDOWN_TABLE_ROW_LIMIT + 3 }, (_, index) => ({ row: index + 1 }));
		const table = createMarkdownTable({ title: 'Rows', rows });

		expect(table).toContain('_3 rows omitted. Open the full result in nao._');
		expect(table).toContain(`| ${MARKDOWN_TABLE_ROW_LIMIT} |`);
		expect(table).not.toContain(`| ${MARKDOWN_TABLE_ROW_LIMIT + 1} |`);
		expect(table).toContain(`| ${MARKDOWN_TABLE_ROW_LIMIT} |\n\n_3 rows omitted.`);
	});

	it('does not emit trailing whitespace on table lines', () => {
		const table = createMarkdownTable({
			title: 'Values',
			rows: [
				{ first: 'one', second: 'two' },
				{ first: 'three', second: 'four' },
			],
		});

		expect(table?.split('\n').every((line) => !/[ \t]+$/.test(line))).toBe(true);
	});

	it('returns null when rows are missing or empty', () => {
		expect(createMarkdownTable({ title: 'Empty', rows: undefined })).toBeNull();
		expect(createMarkdownTable({ title: 'Empty', rows: [] })).toBeNull();
	});

	it('truncates oversized markdown on a complete line with a visible note', () => {
		const markdown = Array.from({ length: 20 }, (_, index) => `Line ${index}`).join('\n');
		const truncated = truncateMarkdown(markdown, 100);

		expect(truncated.length).toBeLessThanOrEqual(100);
		expect(truncated).toContain('Response truncated. Open the full result in nao.');
	});
});

describe('Mattermost chart images', () => {
	it('renders date-axis charts from persisted ISO date strings', () => {
		const svg = renderChartToSvg({
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

		expect(svg).toContain('<svg');
		expect(svg).toContain('Monthly Revenue Trend');
	});
});

describe('resolveSqlOutput', () => {
	it('returns an in-stream result without loading persisted data', async () => {
		const sqlOutput = { name: 'Current', rows: [{ value: 1 }] };
		const loadPersisted = vi.fn(async () => null);
		const result = await resolveSqlOutput({
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
		const first = await resolveSqlOutput({ queryId: 'query-2', sqlOutputs, loadPersisted });
		const second = await resolveSqlOutput({ queryId: 'query-2', sqlOutputs, loadPersisted });

		expect(first).toBe(persisted);
		expect(second).toBe(persisted);
		expect(sqlOutputs.get('query-2')).toBe(persisted);
		expect(loadPersisted).toHaveBeenCalledOnce();
	});

	it('returns nothing when in-stream and persisted results are missing', async () => {
		await expect(
			resolveSqlOutput({
				queryId: 'missing',
				sqlOutputs: new Map(),
				loadPersisted: vi.fn(async () => null),
			}),
		).resolves.toBeUndefined();
	});

	it('returns nothing when the persisted lookup fails', async () => {
		await expect(
			resolveSqlOutput({
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

describe('Mattermost feedback metadata', () => {
	it('round-trips signed metadata', () => {
		const metadata = createMattermostFeedbackMetadata('project-1', 'post-1', 'message-1');

		expect(
			verifyMattermostFeedbackMetadata({ [MATTERMOST_FEEDBACK_PROP]: metadata }, 'project-1', 'post-1'),
		).toEqual({
			valid: true,
			assistantMessageId: 'message-1',
		});
	});

	it('rejects modified message IDs and mismatched project or post IDs', () => {
		const metadata = createMattermostFeedbackMetadata('project-1', 'post-1', 'message-1');

		expect(
			verifyMattermostFeedbackMetadata(
				{
					[MATTERMOST_FEEDBACK_PROP]: {
						...metadata,
						assistantMessageId: 'message-2',
					},
				},
				'project-1',
				'post-1',
			),
		).toEqual({ valid: false, reason: 'invalid_signature' });
		expect(
			verifyMattermostFeedbackMetadata({ [MATTERMOST_FEEDBACK_PROP]: metadata }, 'project-2', 'post-1'),
		).toEqual({ valid: false, reason: 'invalid_signature' });
		expect(
			verifyMattermostFeedbackMetadata({ [MATTERMOST_FEEDBACK_PROP]: metadata }, 'project-1', 'post-2'),
		).toEqual({ valid: false, reason: 'invalid_signature' });
	});

	it('rejects missing and malformed props', () => {
		expect(verifyMattermostFeedbackMetadata(undefined, 'project-1', 'post-1')).toEqual({
			valid: false,
			reason: 'missing',
		});
		expect(
			verifyMattermostFeedbackMetadata(
				{ [MATTERMOST_FEEDBACK_PROP]: { version: 1, assistantMessageId: 'message-1' } },
				'project-1',
				'post-1',
			),
		).toEqual({ valid: false, reason: 'malformed' });
	});
});

describe('Mattermost account resolution', () => {
	it('matches a nao user from the Mattermost email and caches it', async () => {
		const input = createAccountInput(vi.fn(async () => 'User@Example.com'));
		const result = await resolveMattermostAccount(input);

		expect(result).toEqual({ email: 'user@example.com' });
		expect(input.emailCache.get('mattermost-user')).toEqual({
			email: 'user@example.com',
			expiresAt: Number.POSITIVE_INFINITY,
		});
		expect(input.findUser).toHaveBeenCalledWith('user@example.com');
	});

	it('caches a missing email', async () => {
		const currentTime = 10_000;
		const input = createAccountInput(
			vi.fn(async () => null),
			() => currentTime,
		);

		expect(await resolveMattermostAccount(input)).toBeNull();
		expect(await resolveMattermostAccount(input)).toBeNull();

		expect(input.fetchEmail).toHaveBeenCalledTimes(1);
		expect(input.findUser).not.toHaveBeenCalled();
		expect(input.emailCache.get('mattermost-user')).toEqual({
			email: null,
			expiresAt: currentTime + 5 * 60 * 1000,
		});
	});

	it('retries email resolution when a cached miss expires', async () => {
		let currentTime = 10_000;
		const input = createAccountInput(
			vi
				.fn<() => Promise<string | null>>()
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce('Recovered@Example.com'),
			() => currentTime,
		);

		expect(await resolveMattermostAccount(input)).toBeNull();
		currentTime += 5 * 60 * 1000;
		expect(await resolveMattermostAccount(input)).toEqual({ email: 'recovered@example.com' });

		expect(input.fetchEmail).toHaveBeenCalledTimes(2);
		expect(input.emailCache.get('mattermost-user')).toEqual({
			email: 'recovered@example.com',
			expiresAt: Number.POSITIVE_INFINITY,
		});
	});

	it('uses a successful email cached after a miss', async () => {
		const currentTime = 10_000;
		const input = createAccountInput(
			vi.fn(async () => null),
			() => currentTime,
		);

		expect(await resolveMattermostAccount(input)).toBeNull();
		cacheMattermostEmail(input.emailCache, 'mattermost-user', 'Manual@Example.com', currentTime);
		expect(await resolveMattermostAccount(input)).toEqual({ email: 'manual@example.com' });

		expect(input.fetchEmail).toHaveBeenCalledTimes(1);
		expect(input.emailCache.get('mattermost-user')).toEqual({
			email: 'manual@example.com',
			expiresAt: Number.POSITIVE_INFINITY,
		});
	});

	function createAccountInput<T extends () => Promise<string | null>>(fetchEmail: T, now?: () => number) {
		return {
			userId: 'mattermost-user',
			emailCache: new Map<string, MattermostEmailCacheEntry>(),
			fetchEmail,
			findUser: vi.fn(async (email: string) => ({ email })),
			now,
		};
	}
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
