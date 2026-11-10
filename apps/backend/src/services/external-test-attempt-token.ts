import crypto from 'node:crypto';

import { env } from '../env';

const TOKEN_PREFIX = 'nao_test_';
const TOKEN_SEPARATOR = '.';
const TOKEN_TTL_MS = 60 * 60_000;

export interface ExternalTestAttemptTokenPayload {
	id: string;
	projectId: string;
	userId: string;
	exp: number;
}

export function createExternalTestAttemptToken(projectId: string, userId: string): {
	id: string;
	token: string;
	expiresAt: Date;
} {
	const id = crypto.randomUUID();
	const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
	const payload: ExternalTestAttemptTokenPayload = { id, projectId, userId, exp: expiresAt.getTime() };
	const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
	const signature = sign(encodedPayload);
	return { id, token: `${TOKEN_PREFIX}${encodedPayload}${TOKEN_SEPARATOR}${signature}`, expiresAt };
}

export function verifyExternalTestAttemptToken(token: string): ExternalTestAttemptTokenPayload | null {
	if (!token.startsWith(TOKEN_PREFIX)) {
		return null;
	}
	const unsigned = token.slice(TOKEN_PREFIX.length);
	const separator = unsigned.lastIndexOf(TOKEN_SEPARATOR);
	if (separator === -1) {
		return null;
	}
	const encodedPayload = unsigned.slice(0, separator);
	const signature = unsigned.slice(separator + 1);
	if (!encodedPayload || !signature || !isValidSignature(encodedPayload, signature)) {
		return null;
	}

	try {
		const payload = JSON.parse(
			Buffer.from(encodedPayload, 'base64url').toString(),
		) as ExternalTestAttemptTokenPayload;
		if (
			typeof payload.id !== 'string' ||
			typeof payload.projectId !== 'string' ||
			typeof payload.userId !== 'string' ||
			typeof payload.exp !== 'number' ||
			payload.exp < Date.now()
		) {
			return null;
		}
		return payload;
	} catch {
		return null;
	}
}

function sign(value: string): string {
	return crypto.createHmac('sha256', env.BETTER_AUTH_SECRET).update(value).digest('base64url');
}

function isValidSignature(value: string, signature: string): boolean {
	try {
		return crypto.timingSafeEqual(Buffer.from(signature, 'base64url'), Buffer.from(sign(value), 'base64url'));
	} catch {
		return false;
	}
}
