import { and, asc, count, eq, inArray, isNotNull, isNull, notInArray, or, sql } from 'drizzle-orm';

import s, { type DBStoryFolder } from '../db/abstractSchema';
import { db } from '../db/db';

export type StoryFolderWithCount = DBStoryFolder & { storyCount: number };

export async function listFolderTree(
	userId: string,
	projectId: string,
	options?: { archived?: boolean },
): Promise<StoryFolderWithCount[]> {
	const itemCounts = db
		.select({
			folderId: s.storyFolderItem.folderId,
			cnt: count(s.storyFolderItem.storyId).as('cnt'),
		})
		.from(s.storyFolderItem)
		.where(eq(s.storyFolderItem.userId, userId))
		.groupBy(s.storyFolderItem.folderId)
		.as('item_counts');

	const archivedFilter = options?.archived ? isNotNull(s.storyFolder.archivedAt) : isNull(s.storyFolder.archivedAt);

	return db
		.select({
			id: s.storyFolder.id,
			userId: s.storyFolder.userId,
			projectId: s.storyFolder.projectId,
			parentId: s.storyFolder.parentId,
			name: s.storyFolder.name,
			favoritedAt: s.storyFolder.favoritedAt,
			archivedAt: s.storyFolder.archivedAt,
			createdAt: s.storyFolder.createdAt,
			updatedAt: s.storyFolder.updatedAt,
			storyCount: sql<number>`coalesce(${itemCounts.cnt}, 0)`,
		})
		.from(s.storyFolder)
		.leftJoin(itemCounts, eq(itemCounts.folderId, s.storyFolder.id))
		.where(and(eq(s.storyFolder.userId, userId), eq(s.storyFolder.projectId, projectId), archivedFilter))
		.orderBy(asc(s.storyFolder.name))
		.execute();
}

export async function toggleFolderFavorite(userId: string, folderId: string): Promise<Date | null> {
	const [folder] = await db
		.select({ favoritedAt: s.storyFolder.favoritedAt })
		.from(s.storyFolder)
		.where(and(eq(s.storyFolder.id, folderId), eq(s.storyFolder.userId, userId)))
		.limit(1)
		.execute();

	if (!folder) {
		return null;
	}

	const newValue = folder.favoritedAt ? null : new Date();
	await db.update(s.storyFolder).set({ favoritedAt: newValue }).where(eq(s.storyFolder.id, folderId)).execute();
	return newValue;
}

export async function getFolderById(id: string): Promise<DBStoryFolder | null> {
	const [row] = await db.select().from(s.storyFolder).where(eq(s.storyFolder.id, id)).limit(1).execute();
	return row ?? null;
}

export async function createFolder(data: {
	userId: string;
	projectId: string;
	name: string;
	parentId?: string | null;
}): Promise<DBStoryFolder> {
	const [folder] = await db
		.insert(s.storyFolder)
		.values({
			userId: data.userId,
			projectId: data.projectId,
			name: data.name,
			parentId: data.parentId ?? null,
		})
		.returning()
		.execute();
	return folder;
}

export async function updateFolder(id: string, data: { name?: string }): Promise<void> {
	const update: { name?: string } = {};
	if (data.name !== undefined) {
		update.name = data.name;
	}
	if (Object.keys(update).length === 0) {
		return;
	}
	await db.update(s.storyFolder).set(update).where(eq(s.storyFolder.id, id)).execute();
}

export async function deleteFolderMovingContentsToParent(folderId: string): Promise<void> {
	const folder = await getFolderById(folderId);
	if (!folder) {
		return;
	}
	const newParentId = folder.parentId;

	if (newParentId === null) {
		await db.delete(s.storyFolderItem).where(eq(s.storyFolderItem.folderId, folderId)).execute();
	} else {
		await db
			.update(s.storyFolderItem)
			.set({ folderId: newParentId })
			.where(eq(s.storyFolderItem.folderId, folderId))
			.execute();
	}

	await db.update(s.storyFolder).set({ parentId: newParentId }).where(eq(s.storyFolder.parentId, folderId)).execute();

	await db.delete(s.storyFolder).where(eq(s.storyFolder.id, folderId)).execute();
}

export async function archiveFolder(userId: string, folderId: string): Promise<void> {
	const folderIds = await listDescendantFolderIds(folderId);
	const now = new Date();

	await db.update(s.storyFolder).set({ archivedAt: now }).where(inArray(s.storyFolder.id, folderIds)).execute();

	const ownStoryIds = await selectOwnStoryIdsInFolders(userId, folderIds);
	if (ownStoryIds.length > 0) {
		await db.update(s.story).set({ archivedAt: now }).where(inArray(s.story.id, ownStoryIds)).execute();
	}

	const detachConditions = [eq(s.storyFolderItem.userId, userId), inArray(s.storyFolderItem.folderId, folderIds)];
	if (ownStoryIds.length > 0) {
		detachConditions.push(notInArray(s.storyFolderItem.storyId, ownStoryIds));
	}
	await db
		.delete(s.storyFolderItem)
		.where(and(...detachConditions))
		.execute();
}

export async function unarchiveFolder(userId: string, folderId: string): Promise<void> {
	const folderIds = await listDescendantFolderIds(folderId);

	await db.update(s.storyFolder).set({ archivedAt: null }).where(inArray(s.storyFolder.id, folderIds)).execute();

	const ownStoryIds = await selectOwnStoryIdsInFolders(userId, folderIds);
	if (ownStoryIds.length > 0) {
		await db.update(s.story).set({ archivedAt: null }).where(inArray(s.story.id, ownStoryIds)).execute();
	}

	await detachFolderIfParentArchived(folderId);
}

async function detachFolderIfParentArchived(folderId: string): Promise<void> {
	const folder = await getFolderById(folderId);
	if (!folder || folder.parentId === null) {
		return;
	}
	const parent = await getFolderById(folder.parentId);
	if (!parent || parent.archivedAt === null) {
		return;
	}
	await db.update(s.storyFolder).set({ parentId: null }).where(eq(s.storyFolder.id, folderId)).execute();
}

export async function clearStoryMembershipIfFolderArchived(userId: string, storyId: string): Promise<void> {
	const [row] = await db
		.select({ archivedAt: s.storyFolder.archivedAt })
		.from(s.storyFolderItem)
		.innerJoin(s.storyFolder, eq(s.storyFolder.id, s.storyFolderItem.folderId))
		.where(and(eq(s.storyFolderItem.userId, userId), eq(s.storyFolderItem.storyId, storyId)))
		.limit(1)
		.execute();

	if (!row || row.archivedAt === null) {
		return;
	}

	await db
		.delete(s.storyFolderItem)
		.where(and(eq(s.storyFolderItem.userId, userId), eq(s.storyFolderItem.storyId, storyId)))
		.execute();
}

async function listDescendantFolderIds(rootFolderId: string): Promise<string[]> {
	const all: string[] = [rootFolderId];
	let frontier: string[] = [rootFolderId];

	while (frontier.length > 0) {
		const children = await db
			.select({ id: s.storyFolder.id })
			.from(s.storyFolder)
			.where(inArray(s.storyFolder.parentId, frontier))
			.execute();

		const nextFrontier = children.map((c) => c.id);
		all.push(...nextFrontier);
		frontier = nextFrontier;
	}

	return all;
}

async function selectOwnStoryIdsInFolders(userId: string, folderIds: string[]): Promise<string[]> {
	if (folderIds.length === 0) {
		return [];
	}

	const rows = await db
		.select({ id: s.story.id })
		.from(s.storyFolderItem)
		.innerJoin(s.story, eq(s.story.id, s.storyFolderItem.storyId))
		.leftJoin(s.chat, eq(s.story.chatId, s.chat.id))
		.where(
			and(
				eq(s.storyFolderItem.userId, userId),
				inArray(s.storyFolderItem.folderId, folderIds),
				or(eq(s.chat.userId, userId), and(isNull(s.story.chatId), eq(s.story.userId, userId))),
			),
		)
		.execute();

	return rows.map((r) => r.id);
}

export async function moveFolder(id: string, newParentId: string | null): Promise<void> {
	await db.update(s.storyFolder).set({ parentId: newParentId }).where(eq(s.storyFolder.id, id)).execute();
}

export async function moveStoryToFolder(userId: string, storyId: string, folderId: string | null): Promise<void> {
	await db
		.delete(s.storyFolderItem)
		.where(and(eq(s.storyFolderItem.userId, userId), eq(s.storyFolderItem.storyId, storyId)))
		.execute();

	if (folderId) {
		await db.insert(s.storyFolderItem).values({ userId, storyId, folderId }).execute();
	}
}

export async function getStoryFolderItem(userId: string, storyId: string): Promise<{ folderId: string } | null> {
	const [row] = await db
		.select({ folderId: s.storyFolderItem.folderId })
		.from(s.storyFolderItem)
		.where(and(eq(s.storyFolderItem.userId, userId), eq(s.storyFolderItem.storyId, storyId)))
		.limit(1)
		.execute();
	return row ?? null;
}

export async function listFolderItemsForUser(
	userId: string,
	projectId: string,
): Promise<{ storyId: string; folderId: string }[]> {
	return db
		.select({
			storyId: s.storyFolderItem.storyId,
			folderId: s.storyFolderItem.folderId,
		})
		.from(s.storyFolderItem)
		.innerJoin(s.storyFolder, eq(s.storyFolderItem.folderId, s.storyFolder.id))
		.where(and(eq(s.storyFolderItem.userId, userId), eq(s.storyFolder.projectId, projectId)))
		.execute();
}

export async function detectFolderCycle(folderId: string, proposedParentId: string): Promise<boolean> {
	let currentId: string | null = proposedParentId;
	const visited = new Set<string>();

	while (currentId) {
		if (currentId === folderId) {
			return true;
		}
		if (visited.has(currentId)) {
			return true;
		}
		visited.add(currentId);

		const [row] = await db
			.select({ parentId: s.storyFolder.parentId })
			.from(s.storyFolder)
			.where(eq(s.storyFolder.id, currentId))
			.limit(1)
			.execute();

		currentId = row?.parentId ?? null;
	}

	return false;
}
