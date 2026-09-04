import { randomBytes } from 'node:crypto';

import { getAuth } from '../auth';

const CODE_IDENTIFIER_PREFIX = 'cli-auth';
const CODE_TTL_MS = 5 * 60 * 1000;

export async function createCliAuthorizationCode(userId: string): Promise<string> {
	const auth = await getAuth();
	const context = await auth.$context;

	const session = await context.internalAdapter.createSession(userId, false, { userAgent: 'nao-cli' });
	const code = randomBytes(32).toString('base64url');

	await context.internalAdapter.createVerificationValue({
		identifier: codeIdentifier(code),
		value: session.token,
		expiresAt: new Date(Date.now() + CODE_TTL_MS),
	});

	return code;
}

export async function exchangeCliAuthorizationCode(code: string): Promise<string | null> {
	const auth = await getAuth();
	const context = await auth.$context;

	const verification = await context.internalAdapter.findVerificationValue(codeIdentifier(code));
	if (!verification) {
		return null;
	}

	await context.internalAdapter.deleteVerificationByIdentifier(verification.identifier);

	if (verification.expiresAt < new Date()) {
		return null;
	}

	return verification.value;
}

function codeIdentifier(code: string): string {
	return `${CODE_IDENTIFIER_PREFIX}:${code}`;
}
