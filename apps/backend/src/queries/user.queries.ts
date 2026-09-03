import type { MemberStatus } from '@nao/shared/types';
import crypto from 'crypto';
import { and, count, eq, inArray, lt, sql } from 'drizzle-orm';

import s, { NewAccount, NewUser, User } from '../db/abstractSchema';
import { db } from '../db/db';
import { takeFirstOrThrow } from '../utils/queries';

export const userMemberStatus = sql<MemberStatus>`case when ${s.user.requiresPasswordReset} then 'invited' else 'active' end`;

export const INVITATION_TTL_DAYS = 7;

export const getUser = async (identifier: { id: string } | { email: string }): Promise<User | null> => {
	const condition = 'id' in identifier ? eq(s.user.id, identifier.id) : eq(s.user.email, identifier.email);

	const [user] = await db.select().from(s.user).where(condition).execute();

	return user ?? null;
};

export const getUserName = async (userId: string): Promise<string | null> => {
	const [user] = await db.select({ name: s.user.name }).from(s.user).where(eq(s.user.id, userId)).execute();
	return user ? user.name : null;
};

export const getUserNames = async (userIds: string[]): Promise<Map<string, string>> => {
	if (userIds.length === 0) {
		return new Map();
	}
	const users = await db
		.select({ id: s.user.id, name: s.user.name })
		.from(s.user)
		.where(inArray(s.user.id, userIds))
		.execute();
	return new Map(users.map((user) => [user.id, user.name]));
};

export const updateUser = async (id: string, name: string): Promise<void> => {
	await db.update(s.user).set({ name }).where(eq(s.user.id, id)).execute();
};

export const getUserMemoryEnabled = async (userId: string): Promise<boolean> => {
	const user = await takeFirstOrThrow(
		db.select({ memoryEnabled: s.user.memoryEnabled }).from(s.user).where(eq(s.user.id, userId)).execute(),
	);

	return user.memoryEnabled;
};

export const setUserMemoryEnabled = async (userId: string, memoryEnabled: boolean): Promise<void> => {
	await db.update(s.user).set({ memoryEnabled }).where(eq(s.user.id, userId)).execute();
};

export const countUsers = async (): Promise<number> => {
	const [result] = await db.select({ count: count() }).from(s.user).execute();
	return result?.count ?? 0;
};

export const getFirstUser = async (): Promise<User | null> => {
	const [user] = await db.select().from(s.user).limit(1).execute();
	return user ?? null;
};

export const createMessagingProviderCode = (): string => {
	return crypto.randomBytes(6).toString('base64url').slice(0, 8).toLowerCase();
};

export const getUserByMessagingProviderCode = async (code: string): Promise<User | null> => {
	const [user] = await db.select().from(s.user).where(eq(s.user.messagingProviderCode, code)).execute();
	return user ?? null;
};

export const regenerateMessagingProviderCode = async (userId: string): Promise<string> => {
	const code = createMessagingProviderCode();
	await db.update(s.user).set({ messagingProviderCode: code }).where(eq(s.user.id, userId)).execute();
	return code;
};

export const getGithubToken = async (userId: string): Promise<string | null> => {
	const [user] = await db
		.select({ githubAccessToken: s.user.githubAccessToken })
		.from(s.user)
		.where(eq(s.user.id, userId))
		.execute();
	return user?.githubAccessToken ?? null;
};

export const updateGithubToken = async (userId: string, token: string | null): Promise<void> => {
	await db.update(s.user).set({ githubAccessToken: token }).where(eq(s.user.id, userId)).execute();
};

export const getGitlabToken = async (userId: string): Promise<string | null> => {
	const [user] = await db
		.select({ gitlabAccessToken: s.user.gitlabAccessToken })
		.from(s.user)
		.where(eq(s.user.id, userId))
		.execute();
	return user?.gitlabAccessToken ?? null;
};

export const updateGitlabToken = async (userId: string, token: string | null): Promise<void> => {
	await db.update(s.user).set({ gitlabAccessToken: token }).where(eq(s.user.id, userId)).execute();
};

export const createUser = async (user: NewUser, account: NewAccount): Promise<User> => {
	return await db.transaction(async (tx) => {
		user.messagingProviderCode = createMessagingProviderCode();
		const [created] = await tx.insert(s.user).values(user).returning().execute();
		await tx.insert(s.account).values(account).execute();
		return created;
	});
};

/** Removes users whose temporary password was issued (or re-issued) over a week ago and never replaced. */
export const deleteExpiredInvitations = async (now = new Date()): Promise<number> => {
	const cutoff = new Date(now.getTime() - INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
	const deleted = await db
		.delete(s.user)
		.where(
			and(
				eq(s.user.requiresPasswordReset, true),
				lt(s.user.updatedAt, cutoff),
				sql`not exists(select 1 from ${s.session} where ${s.session.userId} = ${s.user.id})`,
				sql`not exists(select 1 from ${s.chat} where ${s.chat.userId} = ${s.user.id})`,
			),
		)
		.returning({ id: s.user.id })
		.execute();
	return deleted.length;
};
