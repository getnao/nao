import { and, eq, gt, lte, or, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import { databaseNow, databaseTimeIn } from './database-time';

/** A person editing by hand in one browser tab (`sessionId`), or their agent working in `chatId`. */
export type StoryEditHolder = { userId: string; chatId: string | null; sessionId?: string | null };

export type ActiveStoryEditLock = StoryEditHolder & { userName: string; acquiredAt: Date };

/** Expiry is judged by the database clock, so hosts whose clocks drift apart agree on when a lock lapses. */
export async function tryAcquireStoryEditLock(
	storyId: string,
	holder: StoryEditHolder,
	ttlMs: number,
): Promise<boolean> {
	const expiresAt = databaseTimeIn(ttlMs);
	const rows = await db
		.insert(s.storyEditLock)
		.values({
			storyId,
			userId: holder.userId,
			chatId: holder.chatId,
			sessionId: holder.sessionId ?? null,
			expiresAt,
			acquiredAt: databaseNow,
		})
		.onConflictDoUpdate({
			target: s.storyEditLock.storyId,
			set: {
				userId: holder.userId,
				chatId: holder.chatId,
				sessionId: holder.sessionId ?? null,
				expiresAt,
				acquiredAt: sql`case when ${isHeldBy(holder)} then ${s.storyEditLock.acquiredAt} else excluded.acquired_at end`,
			},
			setWhere: or(lte(s.storyEditLock.expiresAt, databaseNow), isHeldBy(holder)),
		})
		.returning({ storyId: s.storyEditLock.storyId })
		.execute();
	return rows.length > 0;
}

export async function getActiveStoryEditLock(storyId: string): Promise<ActiveStoryEditLock | null> {
	const [row] = await db
		.select({
			userId: s.storyEditLock.userId,
			chatId: s.storyEditLock.chatId,
			sessionId: s.storyEditLock.sessionId,
			userName: s.user.name,
			acquiredAt: s.storyEditLock.acquiredAt,
		})
		.from(s.storyEditLock)
		.innerJoin(s.user, eq(s.user.id, s.storyEditLock.userId))
		.where(and(eq(s.storyEditLock.storyId, storyId), gt(s.storyEditLock.expiresAt, databaseNow)))
		.execute();
	return row ?? null;
}

export async function releaseStoryEditLock(storyId: string, holder: StoryEditHolder): Promise<void> {
	await db
		.delete(s.storyEditLock)
		.where(and(eq(s.storyEditLock.storyId, storyId), isHeldBy(holder)))
		.execute();
}

export async function releaseStoryEditLocksOfChat(chatId: string): Promise<void> {
	await db.delete(s.storyEditLock).where(eq(s.storyEditLock.chatId, chatId)).execute();
}

export async function renewStoryEditLocksOfChat(chatId: string, ttlMs: number): Promise<void> {
	await db
		.update(s.storyEditLock)
		.set({ expiresAt: databaseTimeIn(ttlMs) })
		.where(and(eq(s.storyEditLock.chatId, chatId), gt(s.storyEditLock.expiresAt, databaseNow)))
		.execute();
}

function isHeldBy(holder: StoryEditHolder) {
	return and(
		eq(s.storyEditLock.userId, holder.userId),
		sql`coalesce(${s.storyEditLock.chatId}, '') = ${holder.chatId ?? ''}`,
		sql`coalesce(${s.storyEditLock.sessionId}, '') = ${holder.sessionId ?? ''}`,
	)!;
}
