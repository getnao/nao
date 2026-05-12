import { createHash } from 'node:crypto';

import { and, eq, gt } from 'drizzle-orm';

import { getAuth, verifyOAuthAccessToken } from '../auth';
import s from '../db/abstractSchema';
import { db } from '../db/db';
import { MCP_SERVER_URL } from '../env';
import { logger, serializeError } from '../utils/logger';
import { convertHeaders } from '../utils/utils';

export async function resolveUserId(fastifyRequest: {
	headers: Record<string, string | string[] | undefined>;
	url: string;
}): Promise<string | null> {
	const auth = await getAuth();
	const headers = convertHeaders(fastifyRequest.headers);

	const session = await auth.api.getSession({ headers });
	if (session?.user) {
		return session.user.id;
	}

	return verifyBearerToken(headers.get('authorization'));
}

async function verifyBearerToken(authorization: string | null): Promise<string | null> {
	if (!authorization?.startsWith('Bearer ')) {
		return null;
	}
	const token = authorization.slice('Bearer '.length).trim();
	if (!token) {
		return null;
	}

	const userId = (await verifyAsJwt(token)) ?? (await verifyAsOpaqueToken(token));
	if (!userId) {
		logger.warn('MCP bearer token rejected', { source: 'http' });
	}
	return userId;
}

async function verifyAsJwt(token: string): Promise<string | null> {
	try {
		const payload = await verifyOAuthAccessToken(token, MCP_SERVER_URL);
		return typeof payload.sub === 'string' ? payload.sub : null;
	} catch (error) {
		const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
		logger.warn(`MCP JWT verification failed (audience=${MCP_SERVER_URL}): ${message}`, {
			source: 'http',
			context: { error: serializeError(error) },
		});
		return null;
	}
}

async function verifyAsOpaqueToken(token: string): Promise<string | null> {
	const hashed = sha256Base64Url(token);
	const [row] = await db
		.select({ userId: s.oauthAccessToken.userId })
		.from(s.oauthAccessToken)
		.where(and(eq(s.oauthAccessToken.token, hashed), gt(s.oauthAccessToken.expiresAt, new Date())))
		.limit(1)
		.execute();

	return row?.userId ?? null;
}

function sha256Base64Url(value: string): string {
	return createHash('sha256').update(value).digest('base64url');
}
