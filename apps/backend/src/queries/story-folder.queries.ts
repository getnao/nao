import { and, asc, count, eq } from 'drizzle-orm';

import s, { type DBStoryFolder } from '../db/abstractSchema';
import { db } from '../db/db';

const MAX_FOLDERS_PER_USER = 50;

export async function listFolders(userId: string): Promise<(DBStoryFolder & { storyCount: number })[]> {
	const rows = await db
		.select({
			id: s.storyFolder.id,
			userId: s.storyFolder.userId,
			name: s.storyFolder.name,
			color: s.storyFolder.color,
			position: s.storyFolder.position,
			createdAt: s.storyFolder.createdAt,
			updatedAt: s.storyFolder.updatedAt,
			storyCount: count(s.storyOrganization.id),
		})
		.from(s.storyFolder)
		.leftJoin(s.storyOrganization, eq(s.storyFolder.id, s.storyOrganization.folderId))
		.where(eq(s.storyFolder.userId, userId))
		.groupBy(s.storyFolder.id)
		.orderBy(asc(s.storyFolder.position), asc(s.storyFolder.createdAt))
		.execute();

	return rows;
}

export async function createFolder(
	userId: string,
	data: { name: string; color?: string | null },
): Promise<DBStoryFolder> {
	const [{ folderCount }] = await db
		.select({ folderCount: count(s.storyFolder.id) })
		.from(s.storyFolder)
		.where(eq(s.storyFolder.userId, userId))
		.execute();

	if (folderCount >= MAX_FOLDERS_PER_USER) {
		throw new Error(`Maximum of ${MAX_FOLDERS_PER_USER} folders allowed`);
	}

	const [folder] = await db
		.insert(s.storyFolder)
		.values({
			userId,
			name: data.name,
			color: data.color ?? null,
			position: folderCount,
		})
		.returning()
		.execute();

	return folder;
}

export async function updateFolder(
	userId: string,
	folderId: string,
	data: { name?: string; color?: string | null },
): Promise<DBStoryFolder | null> {
	const [updated] = await db
		.update(s.storyFolder)
		.set(data)
		.where(and(eq(s.storyFolder.id, folderId), eq(s.storyFolder.userId, userId)))
		.returning()
		.execute();

	return updated ?? null;
}

export async function deleteFolder(userId: string, folderId: string): Promise<boolean> {
	const result = await db
		.delete(s.storyFolder)
		.where(and(eq(s.storyFolder.id, folderId), eq(s.storyFolder.userId, userId)))
		.returning({ id: s.storyFolder.id })
		.execute();

	return result.length > 0;
}
