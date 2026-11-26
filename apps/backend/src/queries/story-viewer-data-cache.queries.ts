import { and, eq, inArray, or, sql } from 'drizzle-orm';

import s, { type DBStoryViewerDataCache, type NewStoryViewerDataCache } from '../db/abstractSchema';
import { db, type DBExecutor } from '../db/db';

export interface StoryViewerDataCacheKey {
	storyId: string;
	storyVersionId: string;
	userId: string;
	/** Hashes the viewer's access and the project's cache revision, so a row written under other access never matches. */
	permissionRevision: string;
}

export async function getStoryViewerDataCache(key: StoryViewerDataCacheKey): Promise<DBStoryViewerDataCache | null> {
	const [row] = await db
		.select()
		.from(s.storyViewerDataCache)
		.where(
			and(
				eq(s.storyViewerDataCache.storyId, key.storyId),
				eq(s.storyViewerDataCache.storyVersionId, key.storyVersionId),
				eq(s.storyViewerDataCache.userId, key.userId),
				eq(s.storyViewerDataCache.permissionRevision, key.permissionRevision),
			),
		)
		.limit(1)
		.execute();
	return row ?? null;
}

export async function upsertStoryViewerDataCache(entry: NewStoryViewerDataCache & { cachedAt: Date }): Promise<void> {
	await db
		.insert(s.storyViewerDataCache)
		.values(entry)
		.onConflictDoUpdate({
			target: [s.storyViewerDataCache.storyVersionId, s.storyViewerDataCache.userId],
			set: entry,
		})
		.execute();
}

export async function deleteStoryViewerDataCache(storyId: string): Promise<void> {
	await db.delete(s.storyViewerDataCache).where(eq(s.storyViewerDataCache.storyId, storyId)).execute();
}

/** The new revision retires every viewer cache of the project at once; deleting the rows only reclaims their space. */
export async function invalidateProjectViewerCaches(projectId: string): Promise<void> {
	await bumpProjectViewerCacheRevision(db, [projectId]).execute();
	const projectStoryIds = db
		.select({ id: s.story.id })
		.from(s.story)
		.leftJoin(s.chat, eq(s.story.chatId, s.chat.id))
		.where(or(eq(s.story.projectId, projectId), eq(s.chat.projectId, projectId)));
	await db.delete(s.storyViewerDataCache).where(inArray(s.storyViewerDataCache.storyId, projectStoryIds)).execute();
}

export async function getProjectViewerCacheRevision(projectId: string): Promise<number> {
	const [project] = await db
		.select({ revision: s.project.viewerCacheRevision })
		.from(s.project)
		.where(eq(s.project.id, projectId))
		.limit(1)
		.execute();
	return project?.revision ?? 0;
}

/** Left unexecuted so a caller can run it inside its own transaction, synchronously on SQLite. */
export function bumpProjectViewerCacheRevision(executor: DBExecutor, projectIds: string[]) {
	return executor
		.update(s.project)
		.set({
			viewerCacheRevision: sql`${s.project.viewerCacheRevision} + 1`,
			updatedAt: sql`${s.project.updatedAt}`,
		})
		.where(inArray(s.project.id, projectIds));
}
