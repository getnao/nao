import crypto from 'node:crypto';

import { env } from '../env';

export const DISCORD_LINK_TOKEN_TTL_MINUTES = 15;

const SEPARATOR = '.';
const SIGNATURE_SCOPE = 'discord-link';

export interface DiscordLinkTokenPayload {
	projectId: string;
	discordUserId: string;
	discordUserName: string;
	exp: number;
}

export function generateDiscordLinkToken(data: Omit<DiscordLinkTokenPayload, 'exp'>): string {
	const payload: DiscordLinkTokenPayload = { ...data, exp: Date.now() + DISCORD_LINK_TOKEN_TTL_MINUTES * 60_000 };
	const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
	return `${encodedPayload}${SEPARATOR}${sign(encodedPayload)}`;
}

export function verifyDiscordLinkToken(token: string): DiscordLinkTokenPayload | null {
	const [encodedPayload, signature, ...rest] = token.split(SEPARATOR);
	if (!encodedPayload || !signature || rest.length > 0 || !isValidSignature(encodedPayload, signature)) {
		return null;
	}

	const payload = parsePayload(encodedPayload);
	if (!payload || payload.exp < Date.now()) {
		return null;
	}
	return payload;
}

function sign(encodedPayload: string): string {
	return crypto
		.createHmac('sha256', env.BETTER_AUTH_SECRET)
		.update(`${SIGNATURE_SCOPE}:${encodedPayload}`)
		.digest('base64url');
}

function isValidSignature(encodedPayload: string, signature: string): boolean {
	const expected = Buffer.from(sign(encodedPayload));
	const candidate = Buffer.from(signature);
	return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

function parsePayload(encodedPayload: string): DiscordLinkTokenPayload | null {
	try {
		const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString()) as DiscordLinkTokenPayload;
		return typeof payload.projectId === 'string' &&
			typeof payload.discordUserId === 'string' &&
			typeof payload.exp === 'number'
			? payload
			: null;
	} catch {
		return null;
	}
}
