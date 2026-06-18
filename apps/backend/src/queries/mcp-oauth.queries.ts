import { and, eq } from 'drizzle-orm';

import s, { DBMcpOauthToken } from '../db/abstractSchema';
import { db } from '../db/db';
import { McpOAuthClientInfo } from '../types/mcp-oauth';

interface McpOauthTokenKey {
	userId: string;
	projectId: string;
	serverName: string;
}

interface McpOauthTokens {
	accessToken: string | null;
	refreshToken: string | null;
	accessTokenExpiresAt: Date | null;
	refreshTokenExpiresAt: Date | null;
	scope: string | null;
}

export const getMcpOauthToken = async (key: McpOauthTokenKey): Promise<DBMcpOauthToken | null> => {
	const [token] = await db.select().from(s.mcpOauthToken).where(whereKey(key)).execute();

	return token ?? null;
};

/** Upserts a user's tokens for a server, leaving any stored client info untouched. */
export const saveMcpOauthTokens = async (key: McpOauthTokenKey, tokens: McpOauthTokens): Promise<void> => {
	await db
		.insert(s.mcpOauthToken)
		.values({ ...key, ...tokens })
		.onConflictDoUpdate({
			target: [s.mcpOauthToken.userId, s.mcpOauthToken.projectId, s.mcpOauthToken.serverName],
			set: { ...tokens, updatedAt: new Date() },
		})
		.execute();
};

/** Upserts a user's client registration for a server, leaving any stored tokens untouched. */
export const saveMcpOauthClientInfo = async (key: McpOauthTokenKey, clientInfo: McpOAuthClientInfo): Promise<void> => {
	await db
		.insert(s.mcpOauthToken)
		.values({ ...key, clientInfo })
		.onConflictDoUpdate({
			target: [s.mcpOauthToken.userId, s.mcpOauthToken.projectId, s.mcpOauthToken.serverName],
			set: { clientInfo, updatedAt: new Date() },
		})
		.execute();
};

export const deleteMcpOauthToken = async (key: McpOauthTokenKey): Promise<void> => {
	await db.delete(s.mcpOauthToken).where(whereKey(key)).execute();
};

function whereKey(key: McpOauthTokenKey) {
	return and(
		eq(s.mcpOauthToken.userId, key.userId),
		eq(s.mcpOauthToken.projectId, key.projectId),
		eq(s.mcpOauthToken.serverName, key.serverName),
	);
}
