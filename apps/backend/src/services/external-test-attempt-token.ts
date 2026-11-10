import crypto from 'node:crypto';

import { errors, jwtVerify, SignJWT } from 'jose';

import { env } from '../env';

const TOKEN_PREFIX = 'nao_test_';
const TOKEN_AUDIENCE = 'nao-test-attempt';
const TOKEN_TTL_SECONDS = 60 * 60;

export interface ExternalTestAttemptTokenPayload {
	id: string;
	projectId: string;
	userId: string;
	exp: number;
}

export async function createExternalTestAttemptToken(
	projectId: string,
	userId: string,
): Promise<{
	id: string;
	token: string;
	expiresAt: Date;
}> {
	const id = crypto.randomUUID();
	const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);
	const token = await new SignJWT({ projectId, userId })
		.setProtectedHeader({ alg: 'HS256' })
		.setSubject(id)
		.setAudience(TOKEN_AUDIENCE)
		.setIssuedAt()
		.setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
		.sign(secretKey());
	return { id, token: TOKEN_PREFIX + token, expiresAt };
}

export async function verifyExternalTestAttemptToken(token: string): Promise<ExternalTestAttemptTokenPayload | null> {
	if (!token.startsWith(TOKEN_PREFIX)) {
		return null;
	}
	try {
		const { payload } = await jwtVerify(token.slice(TOKEN_PREFIX.length), secretKey(), {
			algorithms: ['HS256'],
			audience: TOKEN_AUDIENCE,
		});
		if (
			typeof payload.sub !== 'string' ||
			typeof payload.projectId !== 'string' ||
			typeof payload.userId !== 'string' ||
			typeof payload.exp !== 'number'
		) {
			return null;
		}
		return {
			id: payload.sub,
			projectId: payload.projectId,
			userId: payload.userId,
			exp: payload.exp * 1000,
		};
	} catch (error) {
		if (error instanceof errors.JOSEError) {
			return null;
		}
		throw error;
	}
}

function secretKey(): Uint8Array {
	return new TextEncoder().encode(env.BETTER_AUTH_SECRET);
}
