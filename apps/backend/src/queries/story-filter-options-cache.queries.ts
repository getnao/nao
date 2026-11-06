import { and, eq, lt } from 'drizzle-orm';

import s, { type DBStoryFilterOptionsCache } from '../db/abstractSchema';
import { db } from '../db/db';

export async function getFilterOptionsCache(
	storyId: string,
	cacheKey: string,
): Promise<DBStoryFilterOptionsCache | null> {
	const [row] = await db
		.select()
		.from(s.storyFilterOptionsCache)
		.where(and(eq(s.storyFilterOptionsCache.storyId, storyId), eq(s.storyFilterOptionsCache.cacheKey, cacheKey)))
		.limit(1)
		.execute();
	return row ?? null;
}

export async function upsertFilterOptionsCache(
	storyId: string,
	cacheKey: string,
	options: string[],
	isComplete: boolean,
): Promise<void> {
	const cachedAt = new Date();
	await db
		.insert(s.storyFilterOptionsCache)
		.values({ storyId, cacheKey, options, isComplete, cachedAt })
		.onConflictDoUpdate({
			target: [s.storyFilterOptionsCache.storyId, s.storyFilterOptionsCache.cacheKey],
			set: { options, isComplete, cachedAt },
		})
		.execute();
}

export async function deleteFilterOptionsCacheOlderThan(storyId: string, cutoff: Date): Promise<void> {
	await db
		.delete(s.storyFilterOptionsCache)
		.where(and(eq(s.storyFilterOptionsCache.storyId, storyId), lt(s.storyFilterOptionsCache.cachedAt, cutoff)))
		.execute();
}
