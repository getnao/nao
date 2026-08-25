import { createMattermostAdapter } from 'chat-adapter-mattermost';
import { describe, expect, it, vi } from 'vitest';

import { createMattermostActionSecret, verifyMattermostActionSecret } from '../src/utils/mattermost-action-secret';
import { parseMattermostLoginCommand } from '../src/utils/mattermost-login';
import { resolveMattermostReactionFeedback } from '../src/utils/mattermost-reaction';
import { shouldHandleMattermostMessage } from '../src/utils/mattermost-reply';
import {
	buildMattermostAnswerPatchBody,
	createMattermostStopAttachment,
	getMattermostPostBaseProps,
	patchMattermostAnswerPost,
} from '../src/utils/mattermost-stop-action';
import { resolveMattermostThreadId } from '../src/utils/mattermost-thread';
import { resolveMattermostAccount } from '../src/utils/mattermost-user';
import { createMattermostAnswerMessage, resolveMattermostCallbackBaseUrl } from '../src/utils/messaging-provider';

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
		const callbackUrl = 'https://nao.example/api/webhooks/mattermost/project/token';
		const attachment = createMattermostStopAttachment(callbackUrl);
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
									context: { action_id: 'stop_generation' },
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
			attachments: [createMattermostStopAttachment('https://nao.example/callback')],
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
		const emailCache = new Map<string, string>();
		const findUser = vi.fn(async (email: string) => ({ email }));
		const result = await resolveMattermostAccount({
			userId: 'mattermost-user',
			emailCache,
			fetchEmail: vi.fn(async () => 'User@Example.com'),
			findUser,
		});

		expect(result).toEqual({ email: 'user@example.com' });
		expect(emailCache.get('mattermost-user')).toBe('user@example.com');
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
});

describe('Mattermost action secrets', () => {
	it('accepts only the secret derived for the callback project', () => {
		const secret = createMattermostActionSecret('project-1');
		expect(verifyMattermostActionSecret('project-1', secret)).toBe(true);
		expect(verifyMattermostActionSecret('project-2', secret)).toBe(false);
		expect(verifyMattermostActionSecret('project-1', 'invalid')).toBe(false);
	});
});
