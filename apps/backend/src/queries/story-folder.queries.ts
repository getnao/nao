import { SHARED_WITH_ME_FOLDER_ID } from '@nao/shared';
import type { FolderVisibility } from '@nao/shared/types';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, not, or, type SQL, sql } from 'drizzle-orm';

import s, { type DBStoryFolder } from '../db/abstractSchema';
import { db, type DBExecutor, type DBTransaction } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import { withKeyedLock } from '../utils/keyed-lock';
import { listLockedUserGroupIds } from './locked-user-groups';
import {
	getSharedStoryAllowedGroupIds,
	getSharedStoryAllowedUserIds,
	getSharedStoryInfo,
	listAdminsSeeingSharedStory,
	sharedStoryGrantsUser,
} from './shared-story.queries';
import { getStoryOwnerId } from './story.queries';
import * as storyDeliveryQueries from './story-delivery.queries';
import type { ReferenceableStoryFilters } from './story-reference.queries';
import { listUserIdsInGroups } from './user-group.queries';

type FolderStoryFilters = Pick<ReferenceableStoryFilters, 'folderIds' | 'excludedFolderIds' | 'sharedWithMeOnly'>;

type FolderMoveTx = DBTransaction;

/** Checks that must still hold when the change is written, so they run under the project folder lock. */
type FolderChangeCheck = () => Promise<void>;

const writeTransactionConfig = dbConfig.dialect === Dialect.Sqlite ? { behavior: 'immediate' as const } : undefined;

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

export class TeamFolderError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TeamFolderError';
	}
}

export class ArchivedFolderError extends Error {
	constructor() {
		super('Archived folders cannot hold new folders.');
		this.name = 'ArchivedFolderError';
	}
}

/** Who stories placed in a folder are shared with: the project, the groups of a team folder, or nobody. */
export type FolderAudience = { kind: 'project' } | { kind: 'groups'; groupIds: string[] } | { kind: 'private' };

/** Team folders are seen by admins and the members of their groups, like the stories filed there. */
export type FolderViewer = {
	userId: string;
	isAdmin: boolean;
	isViewer: boolean;
	groupIds: ReadonlySet<string>;
};

const PROJECT_AUDIENCE: FolderAudience = { kind: 'project' };

export type StoryFolderWithCount = DBStoryFolder & {
	storyCount: number;
	teamGroupIds: string[];
	teamGroupNames: string[];
};

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
	teamGroupIds: string[];
	teamGroupNames: string[];
};

export type FolderTreeEntry = StoryFolderWithCount | VirtualSharedWithMeFolder;

export async function listFolderTree(
	viewer: FolderViewer,
	projectId: string,
	options?: { archived?: boolean },
): Promise<FolderTreeEntry[]> {
	const archivedFilter = options?.archived ? isNotNull(s.storyFolder.archivedAt) : isNull(s.storyFolder.archivedAt);
	const folders = await listVisibleFolders(viewer, projectId, archivedFilter);

	if (options?.archived) {
		return folders;
	}

	const sharedWithMeCount = await countSharedWithMeStories(viewer.userId, projectId, listTeamFolderIds(folders));
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
			teamGroupIds: [],
			teamGroupNames: [],
		};
		return [virtual, ...folders];
	}

	return folders;
}

async function listVisibleFolders(
	viewer: FolderViewer,
	projectId: string,
	archivedFilter?: SQL,
): Promise<StoryFolderWithCount[]> {
	const itemCounts = db
		.select({
			folderId: s.storyFolderItem.folderId,
			cnt: count(s.storyFolderItem.storyId).as('cnt'),
		})
		.from(s.storyFolderItem)
		.groupBy(s.storyFolderItem.folderId)
		.as('item_counts');

	const visibilityFilter = viewer.isViewer
		? eq(s.storyFolder.visibility, 'public')
		: or(eq(s.storyFolder.visibility, 'public'), eq(s.storyFolder.ownerId, viewer.userId));

	const [folders, teamGroupRows] = await Promise.all([
		db
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
			.where(and(eq(s.storyFolder.projectId, projectId), archivedFilter, visibilityFilter))
			.orderBy(asc(s.storyFolder.name))
			.execute(),
		listProjectTeamGroupRows(projectId),
	]);

	const teamGroupIdsByFolder = groupTeamRowsByFolder(teamGroupRows);
	const groupNamesById = new Map(teamGroupRows.map((row) => [row.groupId, row.groupName]));
	const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
	return folders
		.map((folder) => {
			const teamFolder = findTeamFolder(folder, foldersById, teamGroupIdsByFolder);
			const teamGroupIds = teamFolder ? teamGroupIdsByFolder.get(teamFolder.id)! : [];
			return {
				...folder,
				teamGroupIds,
				teamGroupNames: teamGroupIds.map((groupId) => groupNamesById.get(groupId)!),
			};
		})
		.filter((folder) => canSeeTeamFolder(folder.teamGroupIds, viewer));
}

/**
 * The filters selecting the stories of a folder and of its subfolders, null when the folder is archived or
 * out of the user's reach. The stories themselves still have to be checked for access.
 */
export async function findReferencedFolder(
	viewer: FolderViewer,
	projectId: string,
	folderId: string,
): Promise<{ name: string; filters: FolderStoryFilters } | null> {
	if (folderId === SHARED_WITH_ME_FOLDER_ID) {
		const folders = await listVisibleFolders(viewer, projectId, isNull(s.storyFolder.archivedAt));
		return {
			name: 'Shared with me',
			filters: { sharedWithMeOnly: true, excludedFolderIds: listTeamFolderIds(folders) },
		};
	}
	const folder = await getFolderById(folderId);
	if (
		!folder ||
		folder.projectId !== projectId ||
		folder.archivedAt !== null ||
		!(await canSeeFolder(folder, viewer))
	) {
		return null;
	}
	return { name: folder.name, filters: { folderIds: await listDescendantFolderIds(folderId) } };
}

export async function canSeeFolder(folder: DBStoryFolder, viewer: FolderViewer): Promise<boolean> {
	if (folder.visibility === 'private') {
		return folder.ownerId === viewer.userId;
	}
	const teamFolder = await findTeamFolderOf(folder.id);
	return canSeeTeamFolder(teamFolder?.groupIds ?? [], viewer);
}

function canSeeTeamFolder(teamGroupIds: string[], viewer: FolderViewer): boolean {
	return teamGroupIds.length === 0 || viewer.isAdmin || teamGroupIds.some((groupId) => viewer.groupIds.has(groupId));
}

function listTeamFolderIds(folders: StoryFolderWithCount[]): string[] {
	return folders.filter((folder) => folder.teamGroupIds.length > 0).map((folder) => folder.id);
}

/** Stories filed in a team folder the user sees are listed there, not in "Shared with me". */
async function countSharedWithMeStories(userId: string, projectId: string, teamFolderIds: string[]): Promise<number> {
	const lockedGroupIds = await listLockedUserGroupIds(projectId);
	const filedInTeamFolder =
		teamFolderIds.length > 0
			? sql`${s.sharedStory.storyId} in (${db
					.select({ storyId: s.storyFolderItem.storyId })
					.from(s.storyFolderItem)
					.where(inArray(s.storyFolderItem.folderId, teamFolderIds))})`
			: sql`1 = 0`;
	const [row] = await db
		.select({ cnt: count(s.sharedStory.id) })
		.from(s.sharedStory)
		.innerJoin(s.story, eq(s.story.id, s.sharedStory.storyId))
		.where(
			and(
				eq(s.sharedStory.projectId, projectId),
				isNull(s.story.archivedAt),
				eq(s.sharedStory.visibility, 'specific'),
				sharedStoryGrantsUser(userId, lockedGroupIds),
				not(filedInTeamFolder),
			),
		)
		.execute();
	return row?.cnt ?? 0;
}

async function listProjectTeamGroupRows(projectId: string, executor: DBExecutor = db) {
	return executor
		.select({
			folderId: s.storyFolderGroup.folderId,
			groupId: s.storyFolderGroup.groupId,
			groupName: s.userGroup.name,
		})
		.from(s.storyFolderGroup)
		.innerJoin(s.storyFolder, eq(s.storyFolder.id, s.storyFolderGroup.folderId))
		.innerJoin(s.userGroup, eq(s.userGroup.id, s.storyFolderGroup.groupId))
		.where(eq(s.storyFolder.projectId, projectId))
		.execute();
}

function groupTeamRowsByFolder(rows: Array<{ folderId: string; groupId: string }>): Map<string, string[]> {
	const groupIdsByFolder = new Map<string, string[]>();
	for (const { folderId, groupId } of rows) {
		groupIdsByFolder.set(folderId, [...(groupIdsByFolder.get(folderId) ?? []), groupId]);
	}
	return groupIdsByFolder;
}

/** The folder itself or its closest ancestor that belongs to groups, when the ancestors are all listed. */
function findTeamFolder<Folder extends { id: string; parentId: string | null }>(
	folder: Folder,
	foldersById: Map<string, Folder>,
	teamGroupIdsByFolder: Map<string, string[]>,
): Folder | null {
	const visited = new Set<string>();
	let current: Folder | undefined = folder;
	while (current && !visited.has(current.id)) {
		if (teamGroupIdsByFolder.has(current.id)) {
			return current;
		}
		visited.add(current.id);
		current = current.parentId ? foldersById.get(current.parentId) : undefined;
	}
	return null;
}

/** The team folder a folder sits in, itself included, with the groups it belongs to. */
export async function findTeamFolderOf(
	folderId: string,
	executor: DBExecutor = db,
): Promise<{ id: string; groupIds: string[] } | null> {
	const visited = new Set<string>();
	let currentId: string | null = folderId;
	while (currentId && !visited.has(currentId)) {
		visited.add(currentId);
		const groupIds = await listFolderGroupIds(currentId, executor);
		const folder = await getFolderById(currentId, executor);
		if (!folder) {
			return null;
		}
		if (groupIds.length > 0) {
			return { id: folder.id, groupIds };
		}
		currentId = folder.parentId;
	}
	return null;
}

async function listFolderGroupIds(folderId: string, executor: DBExecutor = db): Promise<string[]> {
	const rows = await executor
		.select({ groupId: s.storyFolderGroup.groupId })
		.from(s.storyFolderGroup)
		.where(eq(s.storyFolderGroup.folderId, folderId))
		.execute();
	return rows.map((row) => row.groupId);
}

export async function resolveFolderAudience(
	folderId: string | null,
	executor: DBExecutor = db,
): Promise<FolderAudience> {
	if (folderId === null) {
		return PROJECT_AUDIENCE;
	}
	const folder = await getFolderById(folderId, executor);
	if (folder?.visibility === 'private') {
		return { kind: 'private' };
	}
	const teamFolder = folder ? await findTeamFolderOf(folderId, executor) : null;
	return teamFolder ? { kind: 'groups', groupIds: teamFolder.groupIds } : PROJECT_AUDIENCE;
}

/** A team folder moved into an open folder stays a team folder; anywhere else it takes its new parent's audience. */
export async function resolveAudienceAfterMove(
	folderId: string,
	newParentId: string | null,
	executor: DBExecutor = db,
): Promise<FolderAudience> {
	const parentAudience = await resolveFolderAudience(newParentId, executor);
	if (parentAudience.kind !== 'project') {
		return parentAudience;
	}
	const groupIds = await listFolderGroupIds(folderId, executor);
	return groupIds.length > 0 ? { kind: 'groups', groupIds } : PROJECT_AUDIENCE;
}

export function isSameAudience(left: FolderAudience, right: FolderAudience): boolean {
	const leftGroupIds = audienceGroupIds(left);
	const rightGroupIds = audienceGroupIds(right);
	return (
		left.kind === right.kind &&
		leftGroupIds.length === rightGroupIds.length &&
		leftGroupIds.every((groupId) => rightGroupIds.includes(groupId))
	);
}

function audienceGroupIds(audience: FolderAudience): string[] {
	return audience.kind === 'groups' ? audience.groupIds : [];
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

export async function createFolder(
	data: {
		ownerId: string;
		projectId: string;
		name: string;
		parentId?: string | null;
		groupIds?: string[];
	},
	assertAllowed?: FolderChangeCheck,
): Promise<DBStoryFolder> {
	const groupIds = [...new Set(data.groupIds ?? [])];
	return inProjectFolderTransaction(
		data.projectId,
		async (tx) => {
			await assertParentNotArchived(data.parentId ?? null, tx);
			const parentAudience = await resolveFolderAudience(data.parentId ?? null, tx);
			if (groupIds.length > 0 && parentAudience.kind !== 'project') {
				throw new TeamFolderError('Only a folder open to the entire project can hold a team folder.');
			}
			const [folder] = await tx
				.insert(s.storyFolder)
				.values({
					ownerId: data.ownerId,
					projectId: data.projectId,
					name: data.name,
					parentId: data.parentId ?? null,
					visibility: parentAudience.kind === 'private' ? 'private' : 'public',
					systemType: null,
				})
				.returning()
				.execute();
			await insertFolderGroups(folder.id, groupIds, tx);
			return folder;
		},
		assertAllowed,
	);
}

export async function updateFolder(
	projectId: string,
	id: string,
	data: { name?: string },
	assertAllowed?: FolderChangeCheck,
): Promise<void> {
	await assertNotSystemFolder(id);
	const update: { name?: string } = {};
	if (data.name !== undefined) {
		update.name = data.name;
	}
	if (Object.keys(update).length === 0) {
		return;
	}
	await inProjectFolderTransaction(
		projectId,
		async (tx) => {
			await tx.update(s.storyFolder).set(update).where(eq(s.storyFolder.id, id)).execute();
		},
		assertAllowed,
	);
}

/** A deleted team folder never opens its content: subfolders keep its groups, stories go back to their owners. */
export async function deleteFolderMovingContentsToParent(
	folderId: string,
	assertAllowed?: FolderChangeCheck,
): Promise<void> {
	await assertNotSystemFolder(folderId);
	const projectFolder = await getFolderById(folderId);
	if (!projectFolder) {
		return;
	}

	await inProjectFolderTransaction(
		projectFolder.projectId,
		async (tx) => {
			const folder = await getFolderById(folderId, tx);
			if (!folder) {
				return;
			}
			const newParentId = folder.parentId;
			const groupIds = await listFolderGroupIds(folderId, tx);
			if (groupIds.length > 0) {
				await returnStoriesToOwners(folderId, folder.projectId, tx);
			}

			if (newParentId === null) {
				await tx.delete(s.storyFolderItem).where(eq(s.storyFolderItem.folderId, folderId)).execute();
			} else {
				await tx
					.update(s.storyFolderItem)
					.set({ folderId: newParentId })
					.where(eq(s.storyFolderItem.folderId, folderId))
					.execute();
			}

			const childIds = await listChildFolderIds(folderId, tx);
			await tx
				.update(s.storyFolder)
				.set({ parentId: newParentId })
				.where(eq(s.storyFolder.parentId, folderId))
				.execute();
			for (const childId of childIds) {
				await insertFolderGroups(childId, groupIds, tx);
			}

			await tx.delete(s.storyFolder).where(eq(s.storyFolder.id, folderId)).execute();
		},
		assertAllowed,
	);
}

async function returnStoriesToOwners(folderId: string, projectId: string, executor: DBExecutor): Promise<void> {
	const stories = await executor
		.select({ storyId: s.storyFolderItem.storyId, chatUserId: s.chat.userId, storyUserId: s.story.userId })
		.from(s.storyFolderItem)
		.innerJoin(s.story, eq(s.story.id, s.storyFolderItem.storyId))
		.leftJoin(s.chat, eq(s.chat.id, s.story.chatId))
		.where(eq(s.storyFolderItem.folderId, folderId))
		.execute();
	for (const { storyId, chatUserId, storyUserId } of stories) {
		const storyOwnerId = chatUserId ?? storyUserId;
		if (storyOwnerId) {
			const privateFolderId = await ensurePrivateRoot(storyOwnerId, projectId, executor);
			await placeStoryInFolder(storyId, privateFolderId, { storyOwnerId, projectId }, executor);
		}
	}
}

/** All-or-nothing, and a subfolder never shows without its team folder's groups while it is detached. */
export async function archiveFolders(
	projectId: string,
	folderIds: string[],
	assertAllowed?: FolderChangeCheck,
): Promise<void> {
	await inProjectFolderTransaction(
		projectId,
		async (tx) => {
			for (const folderId of folderIds) {
				await archiveFolder(folderId, tx);
			}
		},
		assertAllowed,
	);
}

export async function unarchiveFolders(
	userId: string,
	projectId: string,
	folderIds: string[],
	assertAllowed?: FolderChangeCheck,
): Promise<void> {
	await inProjectFolderTransaction(
		projectId,
		async (tx) => {
			for (const folderId of folderIds) {
				await unarchiveFolder(userId, projectId, folderId, tx);
			}
		},
		assertAllowed,
	);
}

async function archiveFolder(folderId: string, executor: DBExecutor): Promise<void> {
	await assertNotSystemFolder(folderId, executor);
	const folderIds = await listDescendantFolderIds(folderId, executor);
	const now = new Date();

	await executor.update(s.storyFolder).set({ archivedAt: now }).where(inArray(s.storyFolder.id, folderIds)).execute();

	await detachFolder(folderId, null, executor);

	const storyIds = await getStoryIdsInFolders(folderIds, executor);
	if (storyIds.length > 0) {
		await executor.update(s.story).set({ archivedAt: now }).where(inArray(s.story.id, storyIds)).execute();
	}
}

async function unarchiveFolder(
	userId: string,
	projectId: string,
	folderId: string,
	executor: DBExecutor,
): Promise<void> {
	const folderIds = await listDescendantFolderIds(folderId, executor);

	await executor
		.update(s.storyFolder)
		.set({ archivedAt: null })
		.where(inArray(s.storyFolder.id, folderIds))
		.execute();

	const storyIds = await getStoryIdsInFolders(folderIds, executor);
	if (storyIds.length > 0) {
		await executor.update(s.story).set({ archivedAt: null }).where(inArray(s.story.id, storyIds)).execute();
	}

	const folder = await getFolderById(folderId, executor);
	if (!folder) {
		return;
	}
	const parentId = folder.visibility === 'private' ? await ensurePrivateRoot(userId, projectId, executor) : null;
	await detachFolder(folderId, parentId, executor);
}

/** A subfolder leaving its team folder on archive or restore keeps the team folder's groups. */
async function detachFolder(folderId: string, parentId: string | null, executor: DBExecutor): Promise<void> {
	const teamFolder = await findTeamFolderOf(folderId, executor);
	await executor.update(s.storyFolder).set({ parentId }).where(eq(s.storyFolder.id, folderId)).execute();
	if (teamFolder && teamFolder.id !== folderId) {
		await insertFolderGroups(folderId, teamFolder.groupIds, executor);
	}
}

export async function moveFolder(
	userId: string,
	projectId: string,
	id: string,
	newParentId: string | null,
	assertAllowed?: FolderChangeCheck,
): Promise<void> {
	await inProjectFolderTransaction(
		projectId,
		async (tx) => {
			await assertNotSystemFolder(id, tx);
			await relocateFolder(userId, projectId, id, newParentId, tx);
		},
		assertAllowed,
	);
}

/** All-or-nothing, so a failing item never leaves part of the selection moved. */
export async function moveItemsToFolder(
	userId: string,
	projectId: string,
	items: { folderIds: string[]; stories: { storyId: string; storyOwnerId: string }[] },
	targetFolderId: string | null,
	assertAllowed?: FolderChangeCheck,
): Promise<void> {
	await inProjectFolderTransaction(
		projectId,
		async (tx) => {
			for (const folderId of items.folderIds) {
				await assertNotSystemFolder(folderId, tx);
			}
			for (const folderId of items.folderIds) {
				await relocateFolder(userId, projectId, folderId, targetFolderId, tx);
			}
			for (const { storyId, storyOwnerId } of items.stories) {
				await placeStoryInFolder(storyId, targetFolderId, { storyOwnerId, projectId }, tx);
			}
		},
		assertAllowed,
	);
}

async function relocateFolder(
	userId: string,
	projectId: string,
	id: string,
	newParentId: string | null,
	tx: FolderMoveTx,
): Promise<void> {
	if (newParentId !== null && (await proposedParentChainContains(newParentId, id, tx))) {
		throw new MoveFolderCycleError();
	}
	await assertParentNotArchived(newParentId, tx);

	const newVisibility = await resolveFolderVisibility(newParentId, tx);
	const oldFolder = await getFolderById(id, tx);
	const oldVisibility = oldFolder?.visibility ?? 'public';
	const parentAudience = await resolveFolderAudience(newParentId, tx);
	const subtreeIds = await listDescendantFolderIds(id, tx);
	const descendantIds = subtreeIds.filter((folderId) => folderId !== id);
	if (parentAudience.kind !== 'project' && (await holdsTeamFolder(descendantIds, tx))) {
		throw new TeamFolderError(
			`"${oldFolder?.name}" contains a team folder, so it can only move into a folder open to the entire project.`,
		);
	}
	const oldAudiences = await resolveFolderAudiences(subtreeIds, tx);

	await tx
		.update(s.storyFolder)
		.set({ parentId: newParentId, visibility: newVisibility })
		.where(eq(s.storyFolder.id, id))
		.execute();

	if (oldVisibility !== newVisibility) {
		await tx
			.update(s.storyFolder)
			.set({ visibility: newVisibility })
			.where(inArray(s.storyFolder.id, subtreeIds))
			.execute();
	}
	if (parentAudience.kind !== 'project') {
		await tx.delete(s.storyFolderGroup).where(inArray(s.storyFolderGroup.folderId, subtreeIds)).execute();
	}

	await propagateFolderAudienceChanges(oldAudiences, projectId, userId, tx);
}

/** Team folders cannot nest, so a folder's audience comes from at most one folder in its parent chain. */
async function resolveFolderAudiences(folderIds: string[], executor: DBExecutor): Promise<Map<string, FolderAudience>> {
	const audiences = new Map<string, FolderAudience>();
	for (const folderId of folderIds) {
		audiences.set(folderId, await resolveFolderAudience(folderId, executor));
	}
	return audiences;
}

async function propagateFolderAudienceChanges(
	previousAudiences: Map<string, FolderAudience>,
	projectId: string,
	userId: string,
	executor: DBExecutor,
): Promise<void> {
	for (const [folderId, previousAudience] of previousAudiences) {
		const audience = await resolveFolderAudience(folderId, executor);
		if (!isSameAudience(previousAudience, audience)) {
			const storyIds = await getStoryIdsInFolders([folderId], executor);
			await propagateShareChange(storyIds, projectId, userId, { from: previousAudience, to: audience }, executor);
		}
	}
}

export async function ensureStoryPrivate(
	storyId: string,
	options: { storyOwnerId: string; projectId: string },
): Promise<void> {
	await db.transaction(async (tx) => {
		const current = await getStoryFolderItem(storyId, tx);
		const currentVisibility = await resolveFolderVisibility(current?.folderId ?? null, tx);
		if (currentVisibility === 'private') {
			return;
		}
		const privateFolderId = await ensurePrivateRoot(options.storyOwnerId, options.projectId, tx);
		await placeStoryInFolder(storyId, privateFolderId, options, tx);
	}, writeTransactionConfig);
}

export async function moveStoryToFolder(
	storyId: string,
	folderId: string | null,
	options: { storyOwnerId: string; projectId: string; assertAllowed?: FolderChangeCheck },
	transaction?: DBTransaction,
): Promise<void> {
	if (transaction) {
		return placeStoryInFolder(storyId, folderId, options, transaction);
	}
	await inProjectFolderTransaction(
		options.projectId,
		(tx) => placeStoryInFolder(storyId, folderId, options, tx),
		options.assertAllowed,
	);
}

/** Folder placement and share visibility must change together, otherwise a story can sit in a public folder unshared. */
async function placeStoryInFolder(
	storyId: string,
	folderId: string | null,
	options: { storyOwnerId: string; projectId: string },
	executor: DBExecutor,
): Promise<void> {
	const previous = await getStoryFolderItem(storyId, executor);
	const previousAudience = await resolveFolderAudience(previous?.folderId ?? null, executor);
	await setStoryFolder(storyId, folderId, executor);

	const audience = await resolveFolderAudience(folderId, executor);
	await propagateShareChange(
		[storyId],
		options.projectId,
		options.storyOwnerId,
		{ from: previousAudience, to: audience },
		executor,
	);
}

/** Files the story without touching who it is shared with, for callers that already set that access. */
export async function setStoryFolder(
	storyId: string,
	folderId: string | null,
	executor: DBExecutor = db,
): Promise<void> {
	await executor.delete(s.storyFolderItem).where(eq(s.storyFolderItem.storyId, storyId)).execute();
	if (folderId) {
		await executor.insert(s.storyFolderItem).values({ storyId, folderId }).execute();
	}
}

/**
 * A story losing its share also loses its delivery, which would otherwise reach every project member. A narrower
 * share keeps the delivery for the recipients it still reaches.
 */
async function propagateShareChange(
	storyIds: string[],
	projectId: string,
	ownerId: string,
	change: { from: FolderAudience; to: FolderAudience },
	executor: DBExecutor = db,
): Promise<void> {
	if (storyIds.length === 0) {
		return;
	}

	const groupIds = audienceGroupIds(change.to);
	const removedGroupIds = audienceGroupIds(change.from).filter((groupId) => !groupIds.includes(groupId));
	if (change.to.kind === 'groups') {
		await shareWithTeamGroups(storyIds, projectId, ownerId, { groupIds, removedGroupIds }, executor);
		if (change.from.kind === 'project' || removedGroupIds.length > 0) {
			await keepDeliveryRecipientsWithinShare(storyIds, projectId, executor);
		}
		return;
	}

	if (change.to.kind === 'project') {
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
				await executor
					.delete(s.sharedStoryGroupAccess)
					.where(eq(s.sharedStoryGroupAccess.sharedStoryId, row.id))
					.execute();
			}
		}
	} else {
		const unsharedProjectWide = await executor
			.delete(s.sharedStory)
			.where(and(inArray(s.sharedStory.storyId, storyIds), eq(s.sharedStory.visibility, 'project')))
			.returning({ storyId: s.sharedStory.storyId })
			.execute();
		const unsharedFromGroups = await revokeTeamGroups(storyIds, projectId, removedGroupIds, executor);
		await storyDeliveryQueries.disableAndResetRecipients(
			[...unsharedProjectWide.map((share) => share.storyId), ...unsharedFromGroups],
			executor,
		);
		await keepDeliveryRecipientsWithinShare(storyIds, projectId, executor);
	}
}

/** A delivery grants its recipients access to the story, so it must not name anyone the share no longer reaches. */
export async function keepDeliveryRecipientsWithinShare(
	storyIds: string[],
	projectId: string,
	executor: DBExecutor = db,
): Promise<void> {
	for (const storyId of storyIds) {
		const delivery = await storyDeliveryQueries.getByStoryId(storyId, executor);
		if (delivery?.recipientMode !== 'specific') {
			continue;
		}
		const share = await getSharedStoryInfo(storyId, projectId, executor);
		const allowedUserIds = share ? await getSharedStoryAllowedUserIds(share.id, executor) : [];
		const allowedGroupIds = share ? await getSharedStoryAllowedGroupIds(share.id, executor) : [];
		const reachedUserIds = new Set([
			...allowedUserIds,
			...(await listUserIdsInGroups(allowedGroupIds, executor)),
			await getStoryOwnerId(storyId, executor),
		]);
		const unreachedUserIds = delivery.recipientUserIds.filter((userId) => !reachedUserIds.has(userId));
		const adminIds = share ? await listAdminsSeeingSharedStory(share.id, unreachedUserIds, executor) : [];
		const userIds = delivery.recipientUserIds.filter(
			(userId) => reachedUserIds.has(userId) || adminIds.includes(userId),
		);
		const groupIds = delivery.recipientGroupIds.filter((groupId) => allowedGroupIds.includes(groupId));
		if (
			userIds.length === delivery.recipientUserIds.length &&
			groupIds.length === delivery.recipientGroupIds.length
		) {
			continue;
		}
		if (userIds.length === 0 && groupIds.length === 0) {
			await storyDeliveryQueries.disableAndResetRecipients([storyId], executor);
		} else {
			await storyDeliveryQueries.setRecipients(storyId, { userIds, groupIds }, executor);
		}
	}
}

/** A team folder shares its stories with its groups only, keeping the people they were already shared with. */
async function shareWithTeamGroups(
	storyIds: string[],
	projectId: string,
	ownerId: string,
	groups: { groupIds: string[]; removedGroupIds: string[] },
	executor: DBExecutor,
): Promise<void> {
	const existing = await executor
		.select({ storyId: s.sharedStory.storyId, id: s.sharedStory.id, visibility: s.sharedStory.visibility })
		.from(s.sharedStory)
		.where(and(inArray(s.sharedStory.storyId, storyIds), eq(s.sharedStory.projectId, projectId)))
		.execute();
	const byStoryId = new Map(existing.map((row) => [row.storyId, row]));

	for (const storyId of storyIds) {
		const row = byStoryId.get(storyId);
		const shareId = row
			? row.id
			: (
					await executor
						.insert(s.sharedStory)
						.values({ storyId, projectId, userId: ownerId, visibility: 'specific' })
						.returning({ id: s.sharedStory.id })
						.execute()
				)[0].id;
		if (row?.visibility === 'project') {
			await executor
				.update(s.sharedStory)
				.set({ visibility: 'specific' })
				.where(eq(s.sharedStory.id, shareId))
				.execute();
		}
		if (groups.removedGroupIds.length > 0) {
			await executor
				.delete(s.sharedStoryGroupAccess)
				.where(
					and(
						eq(s.sharedStoryGroupAccess.sharedStoryId, shareId),
						inArray(s.sharedStoryGroupAccess.groupId, groups.removedGroupIds),
					),
				)
				.execute();
		}
		await executor
			.insert(s.sharedStoryGroupAccess)
			.values(groups.groupIds.map((groupId) => ({ sharedStoryId: shareId, groupId })))
			.onConflictDoNothing()
			.execute();
	}
}

/** Leaving a team folder takes the story away from its groups, and unshares it when nobody else is left. */
async function revokeTeamGroups(
	storyIds: string[],
	projectId: string,
	removedGroupIds: string[],
	executor: DBExecutor,
): Promise<string[]> {
	if (removedGroupIds.length === 0) {
		return [];
	}
	const shares = await executor
		.select({ id: s.sharedStory.id })
		.from(s.sharedStory)
		.where(and(inArray(s.sharedStory.storyId, storyIds), eq(s.sharedStory.projectId, projectId)))
		.execute();
	const shareIds = shares.map((share) => share.id);
	if (shareIds.length === 0) {
		return [];
	}
	await executor
		.delete(s.sharedStoryGroupAccess)
		.where(
			and(
				inArray(s.sharedStoryGroupAccess.sharedStoryId, shareIds),
				inArray(s.sharedStoryGroupAccess.groupId, removedGroupIds),
			),
		)
		.execute();
	const unshared = await executor
		.delete(s.sharedStory)
		.where(
			and(
				inArray(s.sharedStory.id, shareIds),
				eq(s.sharedStory.visibility, 'specific'),
				sql`not exists (select 1 from ${s.sharedStoryAccess} where ${s.sharedStoryAccess.sharedStoryId} = ${s.sharedStory.id})`,
				sql`not exists (select 1 from ${s.sharedStoryGroupAccess} where ${s.sharedStoryGroupAccess.sharedStoryId} = ${s.sharedStory.id})`,
			),
		)
		.returning({ storyId: s.sharedStory.storyId })
		.execute();
	return unshared.map((share) => share.storyId);
}

export async function getStoryFolderItem(
	storyId: string,
	executor: DBExecutor = db,
): Promise<{ folderId: string } | null> {
	const [row] = await executor
		.select({ folderId: s.storyFolderItem.folderId })
		.from(s.storyFolderItem)
		.where(eq(s.storyFolderItem.storyId, storyId))
		.limit(1)
		.execute();
	return row ?? null;
}

export async function listFolderItemsForProject(
	viewer: FolderViewer,
	projectId: string,
): Promise<{ storyId: string; folderId: string }[]> {
	const folderIds = (await listVisibleFolders(viewer, projectId)).map((folder) => folder.id);
	if (folderIds.length === 0) {
		return [];
	}
	return db
		.select({
			storyId: s.storyFolderItem.storyId,
			folderId: s.storyFolderItem.folderId,
		})
		.from(s.storyFolderItem)
		.where(inArray(s.storyFolderItem.folderId, folderIds))
		.execute();
}

/** The folder the user last created, or last shared one of their stories in. */
export async function getLastUsedFolderId(userId: string, projectId: string): Promise<string | null> {
	const [[created], [shared]] = await Promise.all([
		db
			.select({ folderId: s.storyFolder.id, usedAt: s.storyFolder.createdAt })
			.from(s.storyFolder)
			.where(
				and(
					eq(s.storyFolder.ownerId, userId),
					eq(s.storyFolder.projectId, projectId),
					isNull(s.storyFolder.systemType),
					isNull(s.storyFolder.archivedAt),
				),
			)
			.orderBy(desc(s.storyFolder.createdAt))
			.limit(1)
			.execute(),
		db
			.select({ folderId: s.storyFolderItem.folderId, usedAt: s.sharedStory.createdAt })
			.from(s.sharedStory)
			.innerJoin(s.storyFolderItem, eq(s.storyFolderItem.storyId, s.sharedStory.storyId))
			.innerJoin(s.storyFolder, eq(s.storyFolder.id, s.storyFolderItem.folderId))
			.where(
				and(
					eq(s.sharedStory.userId, userId),
					eq(s.sharedStory.projectId, projectId),
					isNull(s.storyFolder.archivedAt),
				),
			)
			.orderBy(desc(s.sharedStory.createdAt))
			.limit(1)
			.execute(),
	]);
	if (!created || !shared) {
		return created?.folderId ?? shared?.folderId ?? null;
	}
	return created.usedAt >= shared.usedAt ? created.folderId : shared.folderId;
}

/**
 * Makes the given public folders the team folders of a group, then reshares the stories of every folder whose
 * audience changed. A team folder cannot sit inside, or contain, another one.
 */
export async function setGroupTeamFolders(
	projectId: string,
	groupId: string,
	folderIds: string[],
	actorId: string,
): Promise<void> {
	await inProjectFolderTransaction(projectId, async (tx) => {
		const currentFolderIds = await listGroupFolderIds(groupId, tx);
		const wantedFolderIds = [...new Set(folderIds)];
		const addedFolderIds = wantedFolderIds.filter((folderId) => !currentFolderIds.includes(folderId));
		const removedFolderIds = currentFolderIds.filter((folderId) => !wantedFolderIds.includes(folderId));
		const affectedFolderIds = (
			await Promise.all(
				[...addedFolderIds, ...removedFolderIds].map((folderId) => listDescendantFolderIds(folderId, tx)),
			)
		).flat();
		const previousAudiences = await resolveFolderAudiences(affectedFolderIds, tx);

		if (removedFolderIds.length > 0) {
			await tx
				.delete(s.storyFolderGroup)
				.where(
					and(
						eq(s.storyFolderGroup.groupId, groupId),
						inArray(s.storyFolderGroup.folderId, removedFolderIds),
					),
				)
				.execute();
		}
		for (const folderId of addedFolderIds) {
			await assertCanBecomeTeamFolder(folderId, projectId, tx);
			await insertFolderGroups(folderId, [groupId], tx);
		}

		await propagateFolderAudienceChanges(previousAudiences, projectId, actorId, tx);
	});
}

/** Archived team folders are left out: the group editor does not list them, so a save must not take them away. */
export async function listGroupFolderIds(groupId: string, executor: DBExecutor = db): Promise<string[]> {
	const rows = await executor
		.select({ folderId: s.storyFolderGroup.folderId })
		.from(s.storyFolderGroup)
		.innerJoin(s.storyFolder, eq(s.storyFolder.id, s.storyFolderGroup.folderId))
		.where(and(eq(s.storyFolderGroup.groupId, groupId), isNull(s.storyFolder.archivedAt)))
		.execute();
	return rows.map((row) => row.folderId);
}

/** The team folders that would be left without any group if the group were deleted. */
export async function listFolderNamesOnlyOwnedByGroup(groupId: string): Promise<string[]> {
	const rows = await db
		.select({ name: s.storyFolder.name, archivedAt: s.storyFolder.archivedAt })
		.from(s.storyFolderGroup)
		.innerJoin(s.storyFolder, eq(s.storyFolder.id, s.storyFolderGroup.folderId))
		.where(
			and(
				eq(s.storyFolderGroup.groupId, groupId),
				sql`(select count(*) from ${s.storyFolderGroup} as other where other.folder_id = ${s.storyFolderGroup.folderId}) = 1`,
			),
		)
		.orderBy(asc(s.storyFolder.name))
		.execute();
	return rows.map((row) => (row.archivedAt ? `${row.name} (archived)` : row.name));
}

async function assertCanBecomeTeamFolder(folderId: string, projectId: string, executor: DBExecutor): Promise<void> {
	const folder = await getFolderById(folderId, executor);
	if (!folder || folder.projectId !== projectId) {
		throw new TeamFolderError('Folder not found.');
	}
	if (folder.visibility !== 'public' || folder.systemType !== null || folder.archivedAt !== null) {
		throw new TeamFolderError('Only active public folders can be team folders.');
	}
	const teamFolder = await findTeamFolderOf(folderId, executor);
	if (teamFolder && teamFolder.id !== folderId) {
		throw new TeamFolderError(`"${folder.name}" is already inside a team folder.`);
	}
	const descendantIds = (await listDescendantFolderIds(folderId, executor)).filter((id) => id !== folderId);
	if (await holdsTeamFolder(descendantIds, executor)) {
		throw new TeamFolderError(`"${folder.name}" already contains a team folder.`);
	}
}

async function holdsTeamFolder(folderIds: string[], executor: DBExecutor): Promise<boolean> {
	if (folderIds.length === 0) {
		return false;
	}
	const [teamFolder] = await executor
		.select({ folderId: s.storyFolderGroup.folderId })
		.from(s.storyFolderGroup)
		.where(inArray(s.storyFolderGroup.folderId, folderIds))
		.limit(1)
		.execute();
	return teamFolder !== undefined;
}

async function insertFolderGroups(folderId: string, groupIds: string[], executor: DBExecutor = db): Promise<void> {
	if (groupIds.length === 0) {
		return;
	}
	await executor
		.insert(s.storyFolderGroup)
		.values(groupIds.map((groupId) => ({ folderId, groupId })))
		.onConflictDoNothing()
		.execute();
}

async function listChildFolderIds(folderId: string, executor: DBExecutor = db): Promise<string[]> {
	const rows = await executor
		.select({ id: s.storyFolder.id })
		.from(s.storyFolder)
		.where(eq(s.storyFolder.parentId, folderId))
		.execute();
	return rows.map((row) => row.id);
}

async function resolveFolderVisibility(folderId: string | null, executor: DBExecutor = db): Promise<FolderVisibility> {
	if (folderId === null) {
		return 'public';
	}
	const folder = await getFolderById(folderId, executor);
	return folder?.visibility ?? 'public';
}

/** Folder listings resolve team groups through active ancestors only, so an active folder must not sit in an archived one. */
async function assertParentNotArchived(parentId: string | null, executor: DBExecutor): Promise<void> {
	const parent = parentId ? await getFolderById(parentId, executor) : null;
	if (parent?.archivedAt != null) {
		throw new ArchivedFolderError();
	}
}

async function assertNotSystemFolder(folderId: string, executor: DBExecutor = db): Promise<void> {
	const folder = await getFolderById(folderId, executor);
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

/**
 * Runs changes to who a project's folders and stories are shared with one at a time, so the checks made inside still
 * hold when the change is written. `work` must not take this lock again.
 */
export function withProjectFolderLock<T>(projectId: string, work: () => Promise<T>): Promise<T> {
	return withKeyedLock(`story-folders:${projectId}`, work);
}

function inProjectFolderTransaction<T>(
	projectId: string,
	work: (tx: FolderMoveTx) => Promise<T>,
	assertAllowed?: FolderChangeCheck,
): Promise<T> {
	return withProjectFolderLock(projectId, async () => {
		await assertAllowed?.();
		return db.transaction(work, writeTransactionConfig);
	});
}

export async function proposedParentChainContains(
	startParentId: string,
	folderId: string,
	executor: DBExecutor = db,
): Promise<boolean> {
	let currentId: string | null = startParentId;
	const visited = new Set<string>();

	while (currentId) {
		if (currentId === folderId || visited.has(currentId)) {
			return true;
		}
		visited.add(currentId);

		const [row] = await executor
			.select({ parentId: s.storyFolder.parentId })
			.from(s.storyFolder)
			.where(eq(s.storyFolder.id, currentId))
			.limit(1)
			.execute();

		currentId = row?.parentId ?? null;
	}

	return false;
}
