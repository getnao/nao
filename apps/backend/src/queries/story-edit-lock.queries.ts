import { and, eq, gt, lte, or, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

/** A person editing by hand in one browser tab (`sessionId`), or their agent working in `chatId`. */
export type StoryEditHolder = { userId: string; chatId: string | null; sessionId?: string | null };

export type ActiveStoryEditLock = StoryEditHolder & { userName: string; acquiredAt: Date };

export async function tryAcquireStoryEditLock(
	storyId: string,
	holder: StoryEditHolder,
	expiresAt: Date,
	now: Date,
): Promise<boolean> {
	const rows = await db
		.insert(s.storyEditLock)
		.values({
			storyId,
			userId: holder.userId,
			chatId: holder.chatId,
			sessionId: holder.sessionId ?? null,
			expiresAt,
			acquiredAt: now,
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
			setWhere: or(lte(s.storyEditLock.expiresAt, now), isHeldBy(holder)),
		})
		.returning({ storyId: s.storyEditLock.storyId })
		.execute();
	return rows.length > 0;
}

export async function getActiveStoryEditLock(storyId: string, now: Date): Promise<ActiveStoryEditLock | null> {
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
		.where(and(eq(s.storyEditLock.storyId, storyId), gt(s.storyEditLock.expiresAt, now)))
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

export async function renewStoryEditLocksOfChat(chatId: string, expiresAt: Date, now: Date): Promise<void> {
	await db
		.update(s.storyEditLock)
		.set({ expiresAt })
		.where(and(eq(s.storyEditLock.chatId, chatId), gt(s.storyEditLock.expiresAt, now)))
		.execute();
}

function isHeldBy(holder: StoryEditHolder) {
	return and(
		eq(s.storyEditLock.userId, holder.userId),
		sql`coalesce(${s.storyEditLock.chatId}, '') = ${holder.chatId ?? ''}`,
		sql`coalesce(${s.storyEditLock.sessionId}, '') = ${holder.sessionId ?? ''}`,
	)!;
}
