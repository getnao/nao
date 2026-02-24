import { desc, eq } from 'drizzle-orm';

import s, { type DBSharedStory, type NewSharedStory } from '../db/abstractSchema';
import { db } from '../db/db';

export type StoryShareWithAuthor = DBSharedStory & { authorName: string };

export async function createSharedStory(story: NewSharedStory): Promise<DBSharedStory> {
	const [created] = await db.insert(s.sharedStory).values(story).returning().execute();
	return created;
}

export async function getSharedStory(id: string): Promise<StoryShareWithAuthor | null> {
	const [row] = await db
		.select({
			id: s.sharedStory.id,
			projectId: s.sharedStory.projectId,
			userId: s.sharedStory.userId,
			title: s.sharedStory.title,
			code: s.sharedStory.code,
			queryData: s.sharedStory.queryData,
			createdAt: s.sharedStory.createdAt,
			authorName: s.user.name,
		})
		.from(s.sharedStory)
		.innerJoin(s.user, eq(s.sharedStory.userId, s.user.id))
		.where(eq(s.sharedStory.id, id))
		.execute();
	return row ?? null;
}

export async function listProjectSharedStories(projectId: string): Promise<DBSharedStory[]> {
	return db
		.select()
		.from(s.sharedStory)
		.where(eq(s.sharedStory.projectId, projectId))
		.orderBy(desc(s.sharedStory.createdAt))
		.execute();
}

export async function deleteSharedStory(id: string): Promise<void> {
	await db.delete(s.sharedStory).where(eq(s.sharedStory.id, id)).execute();
}
