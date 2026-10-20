import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	DISCORD_LINK_TOKEN_TTL_MINUTES,
	generateDiscordLinkToken,
	verifyDiscordLinkToken,
} from '../src/utils/discord-link-token';

const LINK_REQUEST = { projectId: 'project-1', discordUserId: '123456789', discordUserName: 'alice' };

describe('discord link token', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('round-trips the link request', () => {
		const token = generateDiscordLinkToken(LINK_REQUEST);

		expect(verifyDiscordLinkToken(token)).toMatchObject(LINK_REQUEST);
	});

	it('rejects a token with a tampered payload', () => {
		const [, signature] = generateDiscordLinkToken(LINK_REQUEST).split('.');
		const forgedPayload = Buffer.from(
			JSON.stringify({ ...LINK_REQUEST, discordUserId: '987654321', exp: Date.now() + 60_000 }),
		).toString('base64url');

		expect(verifyDiscordLinkToken(`${forgedPayload}.${signature}`)).toBeNull();
	});

	it('rejects malformed tokens', () => {
		expect(verifyDiscordLinkToken('')).toBeNull();
		expect(verifyDiscordLinkToken('not-a-token')).toBeNull();
		expect(verifyDiscordLinkToken('a.b.c')).toBeNull();
	});

	it('rejects an expired token', () => {
		vi.useFakeTimers();
		const token = generateDiscordLinkToken(LINK_REQUEST);

		vi.advanceTimersByTime(DISCORD_LINK_TOKEN_TTL_MINUTES * 60_000 + 1);

		expect(verifyDiscordLinkToken(token)).toBeNull();
	});
});
