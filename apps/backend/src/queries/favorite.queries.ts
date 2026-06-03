import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod/v4';

import s from '../db/abstractSchema';
import { db } from '../db/db';

export const favoriteTargetSchema = z.object({
	type: z.enum(['story', 'folder']),
	id: z.string(),
});

export type FavoriteTarget = z.infer<typeof favoriteTargetSchema>;

export async function toggleFavorite(userId: string, target: FavoriteTarget): Promise<boolean> {
	const condition =
		target.type === 'story'
			? and(eq(s.favorite.userId, userId), eq(s.favorite.storyId, target.id))
			: and(eq(s.favorite.userId, userId), eq(s.favorite.folderId, target.id));

	const values =
		target.type === 'story'
			? { userId, storyId: target.id, folderId: null }
			: { userId, storyId: null, folderId: target.id };

	return await db.transaction(async (tx) => {
		const deleted = await tx.delete(s.favorite).where(condition).returning({ id: s.favorite.id }).execute();
		if (deleted.length > 0) {
			return false;
		}

		await tx.insert(s.favorite).values(values).onConflictDoNothing().execute();
		return true;
	});
}

export async function listFavorites(
	userId: string,
	projectId: string,
): Promise<{ storyIds: string[]; folderIds: string[] }> {
	const [storyRows, folderRows] = await Promise.all([
		db
			.select({ storyId: s.favorite.storyId })
			.from(s.favorite)
			.innerJoin(s.story, eq(s.story.id, s.favorite.storyId))
			.leftJoin(s.chat, eq(s.chat.id, s.story.chatId))
			.where(
				and(
					eq(s.favorite.userId, userId),
					eq(sql`coalesce(${s.chat.projectId}, ${s.story.projectId})`, projectId),
				),
			)
			.execute(),
		db
			.select({ folderId: s.favorite.folderId })
			.from(s.favorite)
			.innerJoin(s.storyFolder, eq(s.storyFolder.id, s.favorite.folderId))
			.where(and(eq(s.favorite.userId, userId), eq(s.storyFolder.projectId, projectId)))
			.execute(),
	]);

	const storyIds = storyRows.map((row) => row.storyId).filter((id): id is string => id !== null);
	const folderIds = folderRows.map((row) => row.folderId).filter((id): id is string => id !== null);

	return { storyIds, folderIds };
}
