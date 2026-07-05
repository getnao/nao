import { and, eq } from 'drizzle-orm';

import type { DBMcpOAuthClient, DBMcpUserToken } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db } from '../db/db';

export const getMcpOAuthClient = async (projectId: string, serverName: string): Promise<DBMcpOAuthClient | null> => {
	const [row] = await db
		.select()
		.from(s.mcpOAuthClient)
		.where(and(eq(s.mcpOAuthClient.projectId, projectId), eq(s.mcpOAuthClient.serverName, serverName)))
		.execute();
	return row ?? null;
};

export const upsertMcpOAuthClient = async (
	projectId: string,
	serverName: string,
	values: { clientId: string; clientSecret: string | null; clientData: string | null },
): Promise<void> => {
	await db
		.insert(s.mcpOAuthClient)
		.values({ projectId, serverName, ...values, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: [s.mcpOAuthClient.projectId, s.mcpOAuthClient.serverName],
			set: { ...values, updatedAt: new Date() },
		})
		.execute();
};

export const setMcpDiscoveryUser = async (
	projectId: string,
	serverName: string,
	discoveryUserId: string,
): Promise<void> => {
	await db
		.update(s.mcpOAuthClient)
		.set({ discoveryUserId, updatedAt: new Date() })
		.where(and(eq(s.mcpOAuthClient.projectId, projectId), eq(s.mcpOAuthClient.serverName, serverName)))
		.execute();
};

export const getMcpUserToken = async (
	userId: string,
	projectId: string,
	serverName: string,
): Promise<DBMcpUserToken | null> => {
	const [row] = await db
		.select()
		.from(s.mcpUserToken)
		.where(
			and(
				eq(s.mcpUserToken.userId, userId),
				eq(s.mcpUserToken.projectId, projectId),
				eq(s.mcpUserToken.serverName, serverName),
			),
		)
		.execute();
	return row ?? null;
};

export const saveMcpCodeVerifier = async (
	userId: string,
	projectId: string,
	serverName: string,
	codeVerifier: string,
): Promise<void> => {
	await db
		.insert(s.mcpUserToken)
		.values({ userId, projectId, serverName, codeVerifier, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: [s.mcpUserToken.userId, s.mcpUserToken.projectId, s.mcpUserToken.serverName],
			set: { codeVerifier, updatedAt: new Date() },
		})
		.execute();
};

export const saveMcpUserTokens = async (
	userId: string,
	projectId: string,
	serverName: string,
	values: { accessToken: string; refreshToken: string | null; expiresAt: Date | null; scope: string | null },
): Promise<void> => {
	await db
		.insert(s.mcpUserToken)
		.values({ userId, projectId, serverName, ...values, codeVerifier: null, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: [s.mcpUserToken.userId, s.mcpUserToken.projectId, s.mcpUserToken.serverName],
			set: { ...values, codeVerifier: null, updatedAt: new Date() },
		})
		.execute();
};

export const deleteMcpUserToken = async (userId: string, projectId: string, serverName: string): Promise<void> => {
	await db
		.delete(s.mcpUserToken)
		.where(
			and(
				eq(s.mcpUserToken.userId, userId),
				eq(s.mcpUserToken.projectId, projectId),
				eq(s.mcpUserToken.serverName, serverName),
			),
		)
		.execute();
};

/** Whether the given user currently holds an access token for the server. */
export const hasMcpUserToken = async (userId: string, projectId: string, serverName: string): Promise<boolean> => {
	const row = await getMcpUserToken(userId, projectId, serverName);
	return !!row?.accessToken;
};
