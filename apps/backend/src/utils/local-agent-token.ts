import crypto from 'node:crypto';

import { env } from '../env';
import type { LocalAgentTokenClaims } from '../types/local-agent';

const TOKEN_PREFIX = 'nao_local_';
const SIGNING_DOMAIN = 'local-agent-mcp:';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

/** A token that only reaches the nao tools of one chat, handed to the Claude process on the user's machine. */
export function generateLocalAgentToken(claims: Omit<LocalAgentTokenClaims, 'expiresAt'>): string {
	const payload: LocalAgentTokenClaims = { ...claims, expiresAt: Date.now() + TOKEN_TTL_MS };
	const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
	return `${TOKEN_PREFIX}${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyLocalAgentToken(token: string): LocalAgentTokenClaims | null {
	if (!token.startsWith(TOKEN_PREFIX)) {
		return null;
	}
	const [encodedPayload, signature, ...rest] = token.slice(TOKEN_PREFIX.length).split('.');
	if (!encodedPayload || !signature || rest.length > 0 || !hasValidSignature(encodedPayload, signature)) {
		return null;
	}
	const claims = parseClaims(encodedPayload);
	if (!claims || claims.expiresAt < Date.now()) {
		return null;
	}
	return claims;
}

function sign(encodedPayload: string): string {
	return crypto
		.createHmac('sha256', env.BETTER_AUTH_SECRET)
		.update(SIGNING_DOMAIN + encodedPayload)
		.digest('base64url');
}

function hasValidSignature(encodedPayload: string, signature: string): boolean {
	const expected = Buffer.from(sign(encodedPayload), 'base64url');
	const candidate = Buffer.from(signature, 'base64url');
	return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

function parseClaims(encodedPayload: string): LocalAgentTokenClaims | null {
	try {
		const claims = JSON.parse(
			Buffer.from(encodedPayload, 'base64url').toString(),
		) as Partial<LocalAgentTokenClaims>;
		const isValid =
			typeof claims.userId === 'string' &&
			typeof claims.projectId === 'string' &&
			typeof claims.chatId === 'string' &&
			typeof claims.expiresAt === 'number';
		return isValid ? (claims as LocalAgentTokenClaims) : null;
	} catch {
		return null;
	}
}
