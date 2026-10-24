import { randomBytes } from 'node:crypto';

import { getAuth } from '../auth';

export const AUTHORIZATION_CLIENTS = ['cli', 'desktop'] as const;
export type AuthorizationClient = (typeof AUTHORIZATION_CLIENTS)[number];

/** Each client gets its own identifier namespace so a code minted for one can never be redeemed by the other. */
const CODE_IDENTIFIER_PREFIXES: Record<AuthorizationClient, string> = {
	cli: 'cli-auth',
	desktop: 'desktop-auth',
};
const CODE_TTL_MS = 5 * 60 * 1000;

export async function createAuthorizationCode(userId: string, client: AuthorizationClient): Promise<string> {
	const auth = await getAuth();
	const context = await auth.$context;

	const code = randomBytes(32).toString('base64url');

	await context.internalAdapter.createVerificationValue({
		identifier: codeIdentifier(code, client),
		value: userId,
		expiresAt: new Date(Date.now() + CODE_TTL_MS),
	});

	return code;
}

/** Redeems a one-time code and returns the user it was minted for, or null when it is unknown, expired or already used. */
export async function consumeAuthorizationCode(code: string, client: AuthorizationClient): Promise<string | null> {
	const auth = await getAuth();
	const context = await auth.$context;

	const verification = await context.internalAdapter.consumeVerificationValue(codeIdentifier(code, client));
	if (!verification || verification.expiresAt < new Date()) {
		return null;
	}
	return verification.value;
}

export async function exchangeCliAuthorizationCode(code: string): Promise<string | null> {
	const userId = await consumeAuthorizationCode(code, 'cli');
	if (!userId) {
		return null;
	}

	const auth = await getAuth();
	const context = await auth.$context;
	const session = await context.internalAdapter.createSession(userId, false, { userAgent: 'nao-cli' });
	return session.token;
}

export async function isTrustedOrigin(origin: string | undefined): Promise<boolean> {
	if (!origin) {
		return false;
	}
	const auth = await getAuth();
	const context = await auth.$context;
	return context.isTrustedOrigin(origin);
}

function codeIdentifier(code: string, client: AuthorizationClient): string {
	return `${CODE_IDENTIFIER_PREFIXES[client]}:${code}`;
}
