import { describe, expect, it, vi } from 'vitest';

import {
	buildDiscordAnswerPayload,
	canUseDiscordInProject,
	createDiscordAnswerAttachment,
	DISCORD_ANSWERING_PLACEHOLDER,
	DISCORD_ATTACHMENT_NOTICE,
	DISCORD_OVERFLOW_FILENAME,
	DISCORD_POST_MAX_LENGTH,
	editDiscordMessage,
	formatDiscordTable,
	hasExplicitDiscordMention,
	resolveDiscordReactionFeedback,
	validateDiscordConnection,
} from '../../src/services/discord-helpers';
import { createMarkdownTable, truncateMarkdown } from '../../src/utils/markdown-messaging';

describe('canUseDiscordInProject', () => {
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

		await expect(validateDiscordConnection({ botToken: 'test-token', fetchImpl })).resolves.toBeUndefined();

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

	it.each([401, 403])('reports rejected bot tokens for HTTP %s', async (status) => {
		const fetchImpl = vi.fn(async () => new Response(null, { status }));

		await expect(validateDiscordConnection({ botToken: 'test-token', fetchImpl })).rejects.toThrow(
			'Discord rejected the bot token. Check the token and try again.',
		);
	});

	it('reports other failed responses with the status code', async () => {
		const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));

		await expect(validateDiscordConnection({ botToken: 'test-token', fetchImpl })).rejects.toThrow(
			'Discord connection failed (HTTP 500).',
		);
	});

	it('reports network failures without exposing provider details', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('connect ECONNREFUSED secret-host'));

		await expect(validateDiscordConnection({ botToken: 'test-token', fetchImpl })).rejects.toMatchObject({
			message: 'Could not reach the Discord API. Check your network and try again.',
		});
	});

	it.each([{}, { id: '' }, { id: 42 }])('rejects malformed successful responses', async (body) => {
		const fetchImpl = vi.fn(async () => Response.json(body));

		await expect(validateDiscordConnection({ botToken: 'test-token', fetchImpl })).rejects.toThrow(
			'Discord returned an unexpected response.',
		);
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

describe('buildDiscordAnswerPayload', () => {
	it('sends the answer as plain content without embeds or link previews', () => {
		const payload = buildDiscordAnswerPayload('**an answer**', false);

		expect(payload.content).toBe('**an answer**');
		expect(payload).not.toHaveProperty('embeds');
		expect(payload.flags).toBe(1 << 2);
	});

	it('carries the Stop action only while generating', () => {
		expect(JSON.stringify(buildDiscordAnswerPayload('an answer', true).components)).toContain('stop_generation');
		expect(buildDiscordAnswerPayload('an answer', false).components).toEqual([]);
	});

	it('falls back to the placeholder when there is no text yet', () => {
		expect(buildDiscordAnswerPayload('', true).content).toBe(DISCORD_ANSWERING_PLACEHOLDER);
	});
});

describe('editDiscordMessage', () => {
	it('patches the message with the full payload', async () => {
		const fetchImpl = vi.fn(async () => Response.json({ id: 'message-1' }));
		const payload = buildDiscordAnswerPayload('an answer', false);

		await editDiscordMessage({
			botToken: 'test-token',
			channelId: 'channel-1',
			messageId: 'message-1',
			payload,
			fetchImpl,
		});

		expect(fetchImpl).toHaveBeenCalledWith(
			'https://discord.com/api/v10/channels/channel-1/messages/message-1',
			expect.objectContaining({
				method: 'PATCH',
				headers: expect.objectContaining({ Authorization: 'Bot test-token' }),
				body: JSON.stringify(payload),
			}),
		);
	});

	it('throws when Discord rejects the edit', async () => {
		const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 429 }));

		await expect(
			editDiscordMessage({
				botToken: 'test-token',
				channelId: 'channel-1',
				messageId: 'message-1',
				payload: buildDiscordAnswerPayload('an answer', false),
				fetchImpl,
			}),
		).rejects.toThrow('HTTP 429');
	});
});

describe('formatDiscordTable', () => {
	it('renders a markdown table as an aligned code block', () => {
		const table = createMarkdownTable({ title: 'Orders', rows: [{ status: 'completed', orders: 67 }] })!;
		const formatted = formatDiscordTable(table);

		expect(formatted).toContain('**Orders**');
		expect(formatted).toContain('```\nstatus    | orders\n');
		expect(formatted).not.toContain('| --- |');
	});
});

describe('Discord answer overflow', () => {
	it('uploads the answer only when it did not fit one post', () => {
		expect(createDiscordAnswerAttachment('x'.repeat(DISCORD_POST_MAX_LENGTH), DISCORD_POST_MAX_LENGTH)).toBeNull();

		const body = 'x'.repeat(DISCORD_POST_MAX_LENGTH + 1);
		const attachment = createDiscordAnswerAttachment(body, DISCORD_POST_MAX_LENGTH);

		expect(attachment?.filename).toBe(DISCORD_OVERFLOW_FILENAME);
		expect(attachment?.mimeType).toBe('text/markdown');
		expect(attachment?.data.toString('utf8')).toBe(body);
	});

	it('points at the attachment, not nao, when the answer was uploaded', () => {
		const truncated = truncateMarkdown('A line of output\n'.repeat(200), 100, DISCORD_ATTACHMENT_NOTICE);

		expect(truncated.length).toBeLessThanOrEqual(100);
		expect(truncated).toContain('The full answer is attached below.');
		expect(truncated).not.toContain('Open the full result in nao');
	});
});

describe('resolveDiscordReactionFeedback', () => {
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
