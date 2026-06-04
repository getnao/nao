import type { FolderVisibility } from '@nao/shared/types';
import { and, asc, count, eq, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm';

import s, { type DBStoryFolder } from '../db/abstractSchema';
import { db, type DBExecutor, type DBTransaction } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';

type FolderMoveTx = DBTransaction;

export class MoveFolderCycleError extends Error {
	constructor() {
		super('Moving this folder would create a cycle.');
		this.name = 'MoveFolderCycleError';
	}
}

export class SystemFolderError extends Error {
	constructor() {
		super('System folders cannot be modified.');
		this.name = 'SystemFolderError';
	}
}

export type StoryFolderWithCount = DBStoryFolder & { storyCount: number };

export type VirtualSharedWithMeFolder = {
	id: '__shared_with_me__';
	ownerId: null;
	projectId: string;
	parentId: null;
	name: 'Shared with me';
	visibility: 'public';
	systemType: 'shared_with_me';
	archivedAt: null;
	createdAt: Date;
	updatedAt: Date;
	storyCount: number;
};

export type FolderTreeEntry = StoryFolderWithCount | VirtualSharedWithMeFolder;

export async function listFolderTree(
	userId: string,
	projectId: string,
	options?: { archived?: boolean },
): Promise<FolderTreeEntry[]> {
	const itemCounts = db
		.select({
			folderId: s.storyFolderItem.folderId,
			cnt: count(s.storyFolderItem.storyId).as('cnt'),
		})
		.from(s.storyFolderItem)
		.groupBy(s.storyFolderItem.folderId)
		.as('item_counts');

	const archivedFilter = options?.archived ? isNotNull(s.storyFolder.archivedAt) : isNull(s.storyFolder.archivedAt);

	const folders = await db
		.select({
			id: s.storyFolder.id,
			ownerId: s.storyFolder.ownerId,
			projectId: s.storyFolder.projectId,
			parentId: s.storyFolder.parentId,
			name: s.storyFolder.name,
			visibility: s.storyFolder.visibility,
			systemType: s.storyFolder.systemType,
			archivedAt: s.storyFolder.archivedAt,
			createdAt: s.storyFolder.createdAt,
			updatedAt: s.storyFolder.updatedAt,
			storyCount: sql<number>`coalesce(${itemCounts.cnt}, 0)`,
		})
		.from(s.storyFolder)
		.leftJoin(itemCounts, eq(itemCounts.folderId, s.storyFolder.id))
		.where(
			and(
				eq(s.storyFolder.projectId, projectId),
				archivedFilter,
				or(eq(s.storyFolder.visibility, 'public'), eq(s.storyFolder.ownerId, userId)),
			),
		)
		.orderBy(asc(s.storyFolder.name))
		.execute();

	if (options?.archived) {
		return folders;
	}

	const sharedWithMeCount = await countSharedWithMeStories(userId, projectId);
	if (sharedWithMeCount > 0) {
		const virtual: VirtualSharedWithMeFolder = {
			id: '__shared_with_me__',
			ownerId: null,
			projectId,
			parentId: null,
			name: 'Shared with me',
			visibility: 'public',
			systemType: 'shared_with_me',
			archivedAt: null,
			createdAt: new Date(0),
			updatedAt: new Date(0),
			storyCount: sharedWithMeCount,
		};
		return [virtual, ...folders];
	}

	return folders;
}

async function countSharedWithMeStories(userId: string, projectId: string): Promise<number> {
	const [row] = await db
		.select({ cnt: count(s.sharedStory.id) })
		.from(s.sharedStory)
		.innerJoin(s.sharedStoryAccess, eq(s.sharedStoryAccess.sharedStoryId, s.sharedStory.id))
		.where(
			and(
				eq(s.sharedStory.projectId, projectId),
				eq(s.sharedStoryAccess.userId, userId),
				eq(s.sharedStory.visibility, 'specific'),
			),
		)
		.execute();
	return row?.cnt ?? 0;
}

export async function getFolderById(id: string, executor: DBExecutor = db): Promise<DBStoryFolder | null> {
	const [row] = await executor.select().from(s.storyFolder).where(eq(s.storyFolder.id, id)).limit(1).execute();
	return row ?? null;
}

export async function ensurePrivateRoot(userId: string, projectId: string, executor: DBExecutor = db): Promise<string> {
	const [folder] = await executor
		.insert(s.storyFolder)
		.values({
			ownerId: userId,
			projectId,
			name: 'My private folder',
			visibility: 'private',
			systemType: 'private_folder',
			parentId: null,
		})
		.onConflictDoUpdate({
			target: [s.storyFolder.projectId, s.storyFolder.ownerId],
			targetWhere: sql`${s.storyFolder.systemType} = 'private_folder'`,
			set: { ownerId: userId },
		})
		.returning({ id: s.storyFolder.id })
		.execute();

	return folder!.id;
}

export async function saveStoryInPrivateRoot(
	userId: string,
	projectId: string,
	storyId: string,
	executor: DBExecutor = db,
): Promise<void> {
	const folderId = await ensurePrivateRoot(userId, projectId, executor);
	await executor.insert(s.storyFolderItem).values({ storyId, folderId }).onConflictDoNothing().execute();
}

export async function rehomeUnarchivedStory(userId: string, projectId: string, storyId: string): Promise<void> {
	const [share] = await db
		.select({ visibility: s.sharedStory.visibility })
		.from(s.sharedStory)
		.where(and(eq(s.sharedStory.storyId, storyId), eq(s.sharedStory.projectId, projectId)))
		.limit(1)
		.execute();

	if (share?.visibility === 'project') {
		await db.delete(s.storyFolderItem).where(eq(s.storyFolderItem.storyId, storyId)).execute();
		return;
	}
	await saveStoryInPrivateRoot(userId, projectId, storyId);
}

export async function createFolder(data: {
	ownerId: string;
	projectId: string;
	name: string;
	parentId?: string | null;
}): Promise<DBStoryFolder> {
	const parentVisibility = await resolveFolderVisibility(data.parentId ?? null);

	const [folder] = await db
		.insert(s.storyFolder)
		.values({
			ownerId: data.ownerId,
			projectId: data.projectId,
			name: data.name,
			parentId: data.parentId ?? null,
			visibility: parentVisibility,
			systemType: null,
		})
		.returning()
		.execute();
	return folder;
}

export async function updateFolder(id: string, data: { name?: string }): Promise<void> {
	await assertNotSystemFolder(id);
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
	await assertNotSystemFolder(folderId);
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

export async function archiveFolder(folderId: string): Promise<void> {
	await assertNotSystemFolder(folderId);
	const folderIds = await listDescendantFolderIds(folderId);
	const now = new Date();

	await db.update(s.storyFolder).set({ archivedAt: now }).where(inArray(s.storyFolder.id, folderIds)).execute();

	await db.update(s.storyFolder).set({ parentId: null }).where(eq(s.storyFolder.id, folderId)).execute();

	const storyIds = await getStoryIdsInFolders(folderIds);
	if (storyIds.length > 0) {
		await db.update(s.story).set({ archivedAt: now }).where(inArray(s.story.id, storyIds)).execute();
	}
}

export async function unarchiveFolder(userId: string, projectId: string, folderId: string): Promise<void> {
	const folderIds = await listDescendantFolderIds(folderId);

	await db.update(s.storyFolder).set({ archivedAt: null }).where(inArray(s.storyFolder.id, folderIds)).execute();

	const storyIds = await getStoryIdsInFolders(folderIds);
	if (storyIds.length > 0) {
		await db.update(s.story).set({ archivedAt: null }).where(inArray(s.story.id, storyIds)).execute();
	}

	const folder = await getFolderById(folderId);
	if (!folder) {
		return;
	}
	const parentId = folder.visibility === 'private' ? await ensurePrivateRoot(userId, projectId) : null;
	await db.update(s.storyFolder).set({ parentId }).where(eq(s.storyFolder.id, folderId)).execute();
}

export async function moveFolder(
	userId: string,
	projectId: string,
	id: string,
	newParentId: string | null,
): Promise<void> {
	await assertNotSystemFolder(id);

	await db.transaction(
		async (tx) => {
			await serializeFolderMovesInProject(tx, projectId);

			if (newParentId !== null && (await proposedParentChainContains(tx, newParentId, id))) {
				throw new MoveFolderCycleError();
			}

			const newVisibility = await resolveFolderVisibility(newParentId, tx);
			const oldFolder = await getFolderById(id, tx);
			const oldVisibility = oldFolder?.visibility ?? 'public';

			await tx
				.update(s.storyFolder)
				.set({ parentId: newParentId, visibility: newVisibility })
				.where(eq(s.storyFolder.id, id))
				.execute();

			if (oldVisibility !== newVisibility) {
				const descendantIds = await listDescendantFolderIds(id, tx);
				if (descendantIds.length > 0) {
					await tx
						.update(s.storyFolder)
						.set({ visibility: newVisibility })
						.where(inArray(s.storyFolder.id, descendantIds))
						.execute();
				}

				const storyIds = await getStoryIdsInFolders([id, ...descendantIds], tx);
				if (storyIds.length > 0) {
					await propagateShareChange(storyIds, projectId, userId, newVisibility, tx);
				}
			}
		},
		{ behavior: 'immediate' },
	);
}

export async function moveStoryToFolder(
	storyId: string,
	folderId: string | null,
	options: { storyOwnerId: string; projectId: string },
): Promise<void> {
	await db.delete(s.storyFolderItem).where(eq(s.storyFolderItem.storyId, storyId)).execute();

	if (folderId) {
		await db.insert(s.storyFolderItem).values({ storyId, folderId }).execute();
	}

	const newVisibility = await resolveFolderVisibility(folderId);
	await propagateShareChange([storyId], options.projectId, options.storyOwnerId, newVisibility);
}

async function propagateShareChange(
	storyIds: string[],
	projectId: string,
	ownerId: string,
	newVisibility: FolderVisibility,
	executor: DBExecutor = db,
): Promise<void> {
	if (storyIds.length === 0) {
		return;
	}

	if (newVisibility === 'public') {
		const existing = await executor
			.select({
				storyId: s.sharedStory.storyId,
				id: s.sharedStory.id,
				visibility: s.sharedStory.visibility,
			})
			.from(s.sharedStory)
			.where(and(inArray(s.sharedStory.storyId, storyIds), eq(s.sharedStory.projectId, projectId)))
			.execute();
		const byStoryId = new Map(existing.map((row) => [row.storyId, row]));

		for (const storyId of storyIds) {
			const row = byStoryId.get(storyId);
			if (!row) {
				await executor
					.insert(s.sharedStory)
					.values({ storyId, projectId, userId: ownerId, visibility: 'project' })
					.execute();
			} else if (row.visibility === 'specific') {
				await executor
					.update(s.sharedStory)
					.set({ visibility: 'project' })
					.where(eq(s.sharedStory.id, row.id))
					.execute();
				await executor
					.delete(s.sharedStoryAccess)
					.where(eq(s.sharedStoryAccess.sharedStoryId, row.id))
					.execute();
			}
		}
	} else {
		await executor
			.delete(s.sharedStory)
			.where(and(inArray(s.sharedStory.storyId, storyIds), eq(s.sharedStory.visibility, 'project')))
			.execute();
	}
}

export async function getStoryFolderItem(storyId: string): Promise<{ folderId: string } | null> {
	const [row] = await db
		.select({ folderId: s.storyFolderItem.folderId })
		.from(s.storyFolderItem)
		.where(eq(s.storyFolderItem.storyId, storyId))
		.limit(1)
		.execute();
	return row ?? null;
}

export async function listFolderItemsForProject(
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
		.where(
			and(
				eq(s.storyFolder.projectId, projectId),
				or(eq(s.storyFolder.visibility, 'public'), eq(s.storyFolder.ownerId, userId)),
			),
		)
		.execute();
}

async function resolveFolderVisibility(folderId: string | null, executor: DBExecutor = db): Promise<FolderVisibility> {
	if (folderId === null) {
		return 'public';
	}
	const folder = await getFolderById(folderId, executor);
	return folder?.visibility ?? 'public';
}

async function assertNotSystemFolder(folderId: string): Promise<void> {
	const folder = await getFolderById(folderId);
	if (folder?.systemType != null) {
		throw new SystemFolderError();
	}
}

async function listDescendantFolderIds(rootFolderId: string, executor: DBExecutor = db): Promise<string[]> {
	const visited = new Set<string>([rootFolderId]);
	let frontier: string[] = [rootFolderId];

	while (frontier.length > 0) {
		const children = await executor
			.select({ id: s.storyFolder.id })
			.from(s.storyFolder)
			.where(inArray(s.storyFolder.parentId, frontier))
			.execute();

		const nextFrontier: string[] = [];
		for (const { id } of children) {
			if (!visited.has(id)) {
				visited.add(id);
				nextFrontier.push(id);
			}
		}
		frontier = nextFrontier;
	}

	return Array.from(visited);
}

async function getStoryIdsInFolders(folderIds: string[], executor: DBExecutor = db): Promise<string[]> {
	if (folderIds.length === 0) {
		return [];
	}

	const rows = await executor
		.select({ storyId: s.storyFolderItem.storyId })
		.from(s.storyFolderItem)
		.where(inArray(s.storyFolderItem.folderId, folderIds))
		.execute();

	return rows.map((r) => r.storyId);
}

async function serializeFolderMovesInProject(tx: FolderMoveTx, projectId: string): Promise<void> {
	if (dbConfig.dialect !== Dialect.Postgres) {
		return;
	}
	const lockKey = `story-folder-move:${projectId}`;
	await (tx as unknown as { execute: (q: SQL) => Promise<unknown> }).execute(
		sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`,
	);
}

async function proposedParentChainContains(
	tx: FolderMoveTx,
	startParentId: string,
	folderId: string,
): Promise<boolean> {
	let currentId: string | null = startParentId;
	const visited = new Set<string>();

	while (currentId) {
		if (currentId === folderId || visited.has(currentId)) {
			return true;
		}
		visited.add(currentId);

		const [row] = await tx
			.select({ parentId: s.storyFolder.parentId })
			.from(s.storyFolder)
			.where(eq(s.storyFolder.id, currentId))
			.limit(1)
			.execute();

		currentId = row?.parentId ?? null;
	}

	return false;
}
