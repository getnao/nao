import { extractQueryIds } from '@nao/shared/story-segments';
import { SHARE_ROLES, type ShareRole, type StoryFormat } from '@nao/shared/types';
import {
	aliasedTable,
	and,
	type AnyColumn,
	count,
	countDistinct,
	desc,
	eq,
	inArray,
	isNull,
	max,
	notInArray,
	or,
	type SQL,
	sql,
} from 'drizzle-orm';

import s, { type DBSharedStory } from '../db/abstractSchema';
import { db, type DBExecutor } from '../db/db';
import * as executeSqlQueries from './execute-sql.queries';
import { listLockedUserGroupIds, listLockedUserGroupIdsOfMember } from './locked-user-groups';

const storyCertifier = aliasedTable(s.user, 'story_certifier');

export type SharedStoryWithLatest = DBSharedStory & {
	updatedAt: Date;
	authorName: string;
	ownerUserId: string;
	chatId: string | null;
	slug: string;
	title: string;
	format: StoryFormat;
	code: string;
	storyVersionId: string;
	version: number;
	isLive: boolean;
	certifiedAt: Date | null;
	certifiedByName: string | null;
	sharedWithCount: number;
	sharedWithGroupCount: number;
};

export type ShareRecipients = {
	userIds: string[];
	groupIds: string[];
};

export async function createSharedStory(
	data: Pick<DBSharedStory, 'storyId' | 'projectId' | 'userId' | 'visibility'>,
	recipients?: Partial<ShareRecipients>,
	options?: { pinned?: boolean },
): Promise<DBSharedStory> {
	const pinned = options?.pinned === true;

	const [existing] = await db
		.select()
		.from(s.sharedStory)
		.where(and(eq(s.sharedStory.projectId, data.projectId), eq(s.sharedStory.storyId, data.storyId)))
		.limit(1)
		.execute();

	let saved: DBSharedStory;
	if (existing) {
		const [updated] = await db
			.update(s.sharedStory)
			.set({ visibility: data.visibility, ...(options?.pinned !== undefined ? { isPinned: pinned } : {}) })
			.where(eq(s.sharedStory.id, existing.id))
			.returning()
			.execute();
		saved = updated;
		await deleteSharedStoryRecipients(existing.id);
	} else {
		const [created] = await db
			.insert(s.sharedStory)
			.values({
				...data,
				isPinned: pinned,
			})
			.returning()
			.execute();
		saved = created;
	}

	if (data.visibility === 'specific') {
		await insertSharedStoryRecipients(saved.id, recipients);
	}

	return saved;
}

export async function getSharedStory(id: string): Promise<SharedStoryWithLatest | null> {
	const [row] = await querySharedStories(eq(s.sharedStory.id, id));
	return row ?? null;
}

export async function getSharedStoryByStoryId(storyId: string): Promise<SharedStoryWithLatest | null> {
	const [row] = await querySharedStories(eq(s.sharedStory.storyId, storyId));
	return row ?? null;
}

export async function canUserAccessSharedStory(sharedStoryId: string, userId: string): Promise<boolean> {
	const lockedGroupIds = await listLockedUserGroupIdsOfMember(userId);
	const [row] = await db
		.select({ id: s.sharedStory.id })
		.from(s.sharedStory)
		.where(and(eq(s.sharedStory.id, sharedStoryId), sharedStoryGrantsUser(userId, lockedGroupIds)))
		.limit(1)
		.execute();
	return !!row;
}

/** Matches `shared_story` rows granted to the user directly or through one of their active user groups. */
export function sharedStoryGrantsUser(userId: string, lockedGroupIds: readonly string[]): SQL {
	return sql`(${directlyGrantsUser(userId, SHARE_ROLES)} or ${groupGrantsUser(userId, SHARE_ROLES, lockedGroupIds)})`;
}

/**
 * Matches `shared_story` rows that let the user edit. A role given to the user directly wins;
 * otherwise their groups' roles apply to a share with specific people, and the project-wide role to a project share.
 * Project viewers never edit, whatever role the share grants them.
 */
export function sharedStoryGrantsEditor(userId: string, lockedGroupIds: readonly string[]): SQL {
	const isProjectEditor = and(eq(s.sharedStory.visibility, 'project'), eq(s.sharedStory.projectRole, 'editor'));
	const isGroupEditor = and(
		eq(s.sharedStory.visibility, 'specific'),
		groupGrantsUser(userId, ['editor'], lockedGroupIds),
	);
	const grantsEditorRole = sql`(${directlyGrantsUser(userId, ['editor'])} or (not ${directlyGrantsUser(userId, SHARE_ROLES)} and (${isGroupEditor} or ${isProjectEditor})))`;
	return sql`(${grantsEditorRole} and ${canWriteInStoryProject(userId)})`;
}

export async function getStoryShareRole(storyId: string, userId: string): Promise<ShareRole | null> {
	const lockedGroupIds = await listLockedUserGroupIdsOfMember(userId);
	const [row] = await db
		.select({
			isEditor: sql<unknown>`case when ${sharedStoryGrantsEditor(userId, lockedGroupIds)} then 1 else 0 end`,
		})
		.from(s.sharedStory)
		.where(
			and(
				eq(s.sharedStory.storyId, storyId),
				or(eq(s.sharedStory.visibility, 'project'), sharedStoryGrantsUser(userId, lockedGroupIds)),
			),
		)
		.limit(1)
		.execute();
	if (!row) {
		return null;
	}
	return Number(row.isEditor) === 1 ? 'editor' : 'viewer';
}

export async function listUserSharedStories(projectId: string, userId: string): Promise<SharedStoryWithLatest[]> {
	const lockedGroupIds = await listLockedUserGroupIds(projectId);
	return querySharedStories(
		and(
			eq(s.sharedStory.projectId, projectId),
			isNull(s.story.archivedAt),
			or(
				eq(s.sharedStory.visibility, 'project'),
				eq(s.sharedStory.userId, userId),
				sharedStoryGrantsUser(userId, lockedGroupIds),
			),
		)!,
	);
}

export function listProjectArchivedSharedStories(projectId: string): Promise<SharedStoryWithLatest[]> {
	return querySharedStories(
		and(
			eq(s.sharedStory.projectId, projectId),
			eq(s.sharedStory.visibility, 'project'),
			sql`${s.story.archivedAt} IS NOT NULL`,
		)!,
	);
}

export async function pinSharedStory(storyId: string): Promise<void> {
	await db.update(s.sharedStory).set({ isPinned: true }).where(eq(s.sharedStory.storyId, storyId)).execute();
}

export async function toggleSharedStoryPin(sharedStoryId: string): Promise<void> {
	const [existing] = await db
		.select({ isPinned: s.sharedStory.isPinned })
		.from(s.sharedStory)
		.where(eq(s.sharedStory.id, sharedStoryId))
		.limit(1)
		.execute();

	if (!existing) {
		return;
	}

	const newPinned = !existing.isPinned;
	await db.update(s.sharedStory).set({ isPinned: newPinned }).where(eq(s.sharedStory.id, sharedStoryId)).execute();
}

export async function getQueryDataFromCode(
	chatId: string,
	code: string,
): Promise<Record<string, { data: unknown[]; columns: string[] }> | null> {
	const queryIds = extractQueryIds(code);
	if (queryIds.size === 0) {
		return null;
	}

	const data = await executeSqlQueries.getLatestSqlQueryDataByIds(chatId, queryIds);
	return Object.keys(data).length > 0 ? data : null;
}

export async function getSharedStoryInfo(
	storyId: string,
	projectId: string,
): Promise<Pick<DBSharedStory, 'id' | 'visibility' | 'projectRole'> | null> {
	const [row] = await db
		.select({
			id: s.sharedStory.id,
			visibility: s.sharedStory.visibility,
			projectRole: s.sharedStory.projectRole,
		})
		.from(s.sharedStory)
		.where(and(eq(s.sharedStory.storyId, storyId), eq(s.sharedStory.projectId, projectId)))
		.limit(1)
		.execute();

	return row ?? null;
}

export type StoryShareAccess = {
	shareId: string;
	visibility: string;
	allowedUserIds: string[];
	allowedGroupIds: string[];
	recipientUserIds: string[];
};

export async function getStoryShareAccess(storyId: string, projectId: string): Promise<StoryShareAccess | null> {
	const info = await getSharedStoryInfo(storyId, projectId);
	if (!info) {
		return null;
	}
	if (info.visibility !== 'specific') {
		return {
			shareId: info.id,
			visibility: info.visibility,
			allowedUserIds: [],
			allowedGroupIds: [],
			recipientUserIds: [],
		};
	}
	const [allowedUserIds, allowedGroupIds, recipientUserIds] = await Promise.all([
		getSharedStoryAllowedUserIds(info.id),
		getSharedStoryAllowedGroupIds(info.id),
		getSharedStoryRecipientUserIds(info.id),
	]);
	return { shareId: info.id, visibility: info.visibility, allowedUserIds, allowedGroupIds, recipientUserIds };
}

export async function getSharedStoryAllowedUserIds(
	sharedStoryId: string,
	executor: DBExecutor = db,
): Promise<string[]> {
	const rows = await executor
		.select({ userId: s.sharedStoryAccess.userId })
		.from(s.sharedStoryAccess)
		.where(eq(s.sharedStoryAccess.sharedStoryId, sharedStoryId))
		.execute();

	return rows.map((r) => r.userId);
}

export async function getSharedStoryAllowedGroupIds(
	sharedStoryId: string,
	executor: DBExecutor = db,
): Promise<string[]> {
	const rows = await executor
		.select({ groupId: s.sharedStoryGroupAccess.groupId })
		.from(s.sharedStoryGroupAccess)
		.where(eq(s.sharedStoryGroupAccess.sharedStoryId, sharedStoryId))
		.execute();

	return rows.map((r) => r.groupId);
}

/** Users granted directly plus the current members of every granted user group the plan keeps active. */
export async function getSharedStoryRecipientUserIds(sharedStoryId: string): Promise<string[]> {
	const lockedGroupIds = await listLockedGroupIdsOfSharedStory(sharedStoryId);
	const [directUserIds, groupMembers] = await Promise.all([
		getSharedStoryAllowedUserIds(sharedStoryId),
		db
			.selectDistinct({ userId: s.userGroupMember.userId })
			.from(s.sharedStoryGroupAccess)
			.innerJoin(s.userGroupMember, eq(s.userGroupMember.groupId, s.sharedStoryGroupAccess.groupId))
			.where(
				and(
					eq(s.sharedStoryGroupAccess.sharedStoryId, sharedStoryId),
					excludeLockedGroups(s.sharedStoryGroupAccess.groupId, lockedGroupIds),
				),
			)
			.execute(),
	]);

	return [...new Set([...directUserIds, ...groupMembers.map((member) => member.userId)])];
}

export async function updateSharedStoryRecipients(sharedStoryId: string, recipients: ShareRecipients): Promise<void> {
	await deleteSharedStoryRecipients(sharedStoryId);
	await insertSharedStoryRecipients(sharedStoryId, recipients);
}

export async function addSharedStoryAllowedUsers(sharedStoryId: string, userIds: string[]): Promise<void> {
	if (userIds.length === 0) {
		return;
	}
	await db
		.insert(s.sharedStoryAccess)
		.values(userIds.map((userId) => ({ sharedStoryId, userId })))
		.onConflictDoNothing()
		.execute();
}

export type SharedStoryUserGrant = { id: string; name: string; email: string; role: ShareRole };
export type SharedStoryGroupGrant = { id: string; name: string; memberCount: number; role: ShareRole };

export async function listSharedStoryUserGrants(sharedStoryId: string): Promise<SharedStoryUserGrant[]> {
	return db
		.select({ id: s.user.id, name: s.user.name, email: s.user.email, role: s.sharedStoryAccess.role })
		.from(s.sharedStoryAccess)
		.innerJoin(s.user, eq(s.user.id, s.sharedStoryAccess.userId))
		.where(eq(s.sharedStoryAccess.sharedStoryId, sharedStoryId))
		.orderBy(s.user.name)
		.execute();
}

export async function listSharedStoryGroupGrants(sharedStoryId: string): Promise<SharedStoryGroupGrant[]> {
	const rows = await db
		.select({
			id: s.userGroup.id,
			name: s.userGroup.name,
			role: s.sharedStoryGroupAccess.role,
			memberCount: countDistinct(s.userGroupMember.userId),
		})
		.from(s.sharedStoryGroupAccess)
		.innerJoin(s.userGroup, eq(s.userGroup.id, s.sharedStoryGroupAccess.groupId))
		.leftJoin(s.userGroupMember, eq(s.userGroupMember.groupId, s.userGroup.id))
		.where(eq(s.sharedStoryGroupAccess.sharedStoryId, sharedStoryId))
		.groupBy(s.userGroup.id, s.userGroup.name, s.sharedStoryGroupAccess.role)
		.orderBy(s.userGroup.name)
		.execute();
	return rows.map((row) => ({ ...row, memberCount: Number(row.memberCount) }));
}

export async function upsertSharedStoryRecipients(
	sharedStoryId: string,
	recipients: ShareRecipients,
	role: ShareRole,
	executor: DBExecutor = db,
): Promise<void> {
	const userIds = [...new Set(recipients.userIds)];
	const groupIds = [...new Set(recipients.groupIds)];
	if (userIds.length > 0) {
		await executor
			.insert(s.sharedStoryAccess)
			.values(userIds.map((userId) => ({ sharedStoryId, userId, role })))
			.onConflictDoUpdate({
				target: [s.sharedStoryAccess.sharedStoryId, s.sharedStoryAccess.userId],
				set: { role },
			})
			.execute();
	}
	if (groupIds.length > 0) {
		await executor
			.insert(s.sharedStoryGroupAccess)
			.values(groupIds.map((groupId) => ({ sharedStoryId, groupId, role })))
			.onConflictDoUpdate({
				target: [s.sharedStoryGroupAccess.sharedStoryId, s.sharedStoryGroupAccess.groupId],
				set: { role },
			})
			.execute();
	}
}

export async function removeSharedStoryRecipients(
	sharedStoryId: string,
	recipients: ShareRecipients,
	executor: DBExecutor = db,
): Promise<void> {
	if (recipients.userIds.length > 0) {
		await executor
			.delete(s.sharedStoryAccess)
			.where(
				and(
					eq(s.sharedStoryAccess.sharedStoryId, sharedStoryId),
					inArray(s.sharedStoryAccess.userId, recipients.userIds),
				),
			)
			.execute();
	}
	if (recipients.groupIds.length > 0) {
		await executor
			.delete(s.sharedStoryGroupAccess)
			.where(
				and(
					eq(s.sharedStoryGroupAccess.sharedStoryId, sharedStoryId),
					inArray(s.sharedStoryGroupAccess.groupId, recipients.groupIds),
				),
			)
			.execute();
	}
}

export type SharedStoryRoleGrant = { id: string; role: ShareRole };

/**
 * Replaces who the share names, with their roles, and its general access, all at once.
 * Updating the share row first locks it, so concurrent saves read the access they replace one after the other.
 */
export async function replaceSharedStoryAccess(
	sharedStoryId: string,
	access: Pick<DBSharedStory, 'visibility' | 'projectRole'> & {
		users: SharedStoryRoleGrant[];
		groups: SharedStoryRoleGrant[];
	},
): Promise<void> {
	await db.transaction(async (transaction) => {
		await updateSharedStoryGeneralAccess(
			sharedStoryId,
			{ visibility: access.visibility, projectRole: access.projectRole },
			transaction,
		);
		const currentUserIds = await getSharedStoryAllowedUserIds(sharedStoryId, transaction);
		const currentGroupIds = await getSharedStoryAllowedGroupIds(sharedStoryId, transaction);
		await removeSharedStoryRecipients(
			sharedStoryId,
			{
				userIds: currentUserIds.filter((id) => !access.users.some((user) => user.id === id)),
				groupIds: currentGroupIds.filter((id) => !access.groups.some((group) => group.id === id)),
			},
			transaction,
		);
		for (const role of SHARE_ROLES) {
			await upsertSharedStoryRecipients(
				sharedStoryId,
				{
					userIds: access.users.filter((user) => user.role === role).map((user) => user.id),
					groupIds: access.groups.filter((group) => group.role === role).map((group) => group.id),
				},
				role,
				transaction,
			);
		}
	});
}

export async function updateSharedStoryGeneralAccess(
	sharedStoryId: string,
	access: Pick<DBSharedStory, 'visibility' | 'projectRole'>,
	executor: DBExecutor = db,
): Promise<void> {
	await executor.update(s.sharedStory).set(access).where(eq(s.sharedStory.id, sharedStoryId)).execute();
}

export async function deleteSharedStoryRecipients(sharedStoryId: string): Promise<void> {
	await db.delete(s.sharedStoryAccess).where(eq(s.sharedStoryAccess.sharedStoryId, sharedStoryId)).execute();
	await db
		.delete(s.sharedStoryGroupAccess)
		.where(eq(s.sharedStoryGroupAccess.sharedStoryId, sharedStoryId))
		.execute();
}

export async function deleteSharedStory(id: string): Promise<void> {
	await db.delete(s.sharedStory).where(eq(s.sharedStory.id, id)).execute();
}

export async function deleteProjectWideSharedStory(id: string): Promise<boolean> {
	const deleted = await db
		.delete(s.sharedStory)
		.where(and(eq(s.sharedStory.id, id), eq(s.sharedStory.visibility, 'project')))
		.returning({ id: s.sharedStory.id })
		.execute();
	return deleted.length > 0;
}

export async function listProjectWideSharedStories(
	projectId: string,
	sharerIds: string[],
): Promise<Array<Pick<DBSharedStory, 'id' | 'storyId' | 'projectId' | 'userId'>>> {
	if (sharerIds.length === 0) {
		return [];
	}
	return db
		.select({
			id: s.sharedStory.id,
			storyId: s.sharedStory.storyId,
			projectId: s.sharedStory.projectId,
			userId: s.sharedStory.userId,
		})
		.from(s.sharedStory)
		.where(
			and(
				eq(s.sharedStory.projectId, projectId),
				eq(s.sharedStory.visibility, 'project'),
				inArray(s.sharedStory.userId, sharerIds),
			),
		)
		.execute();
}

async function insertSharedStoryRecipients(
	sharedStoryId: string,
	recipients: Partial<ShareRecipients> | undefined,
): Promise<void> {
	const userIds = [...new Set(recipients?.userIds ?? [])];
	const groupIds = [...new Set(recipients?.groupIds ?? [])];

	if (userIds.length > 0) {
		await db
			.insert(s.sharedStoryAccess)
			.values(userIds.map((userId) => ({ sharedStoryId, userId })))
			.execute();
	}
	if (groupIds.length > 0) {
		await db
			.insert(s.sharedStoryGroupAccess)
			.values(groupIds.map((groupId) => ({ sharedStoryId, groupId })))
			.execute();
	}
}

function directlyGrantsUser(userId: string, roles: readonly ShareRole[]): SQL {
	return sql`exists (
		select 1 from ${s.sharedStoryAccess}
		where ${s.sharedStoryAccess.sharedStoryId} = ${s.sharedStory.id}
		  and ${s.sharedStoryAccess.userId} = ${userId}
		  and ${inArray(s.sharedStoryAccess.role, [...roles])}
	)`;
}

/** Mirrors `getUserRoleInProject`: a project role wins, otherwise the organization role applies. */
function canWriteInStoryProject(userId: string): SQL {
	const isProjectMember = sql`exists (
		select 1 from ${s.projectMember}
		where ${s.projectMember.projectId} = ${s.sharedStory.projectId}
		  and ${s.projectMember.userId} = ${userId}
	)`;
	const isProjectWriter = sql`exists (
		select 1 from ${s.projectMember}
		where ${s.projectMember.projectId} = ${s.sharedStory.projectId}
		  and ${s.projectMember.userId} = ${userId}
		  and ${s.projectMember.role} <> 'viewer'
	)`;
	const isOrganizationWriter = sql`exists (
		select 1 from ${s.project}
		inner join ${s.orgMember} on ${s.orgMember.orgId} = ${s.project.orgId}
		where ${s.project.id} = ${s.sharedStory.projectId}
		  and ${s.orgMember.userId} = ${userId}
		  and ${s.orgMember.role} <> 'viewer'
	)`;
	return sql`(${isProjectWriter} or (not ${isProjectMember} and ${isOrganizationWriter}))`;
}

function groupGrantsUser(userId: string, roles: readonly ShareRole[], lockedGroupIds: readonly string[]): SQL {
	return sql`exists (
		select 1 from ${s.sharedStoryGroupAccess}
		inner join ${s.userGroupMember} on ${s.userGroupMember.groupId} = ${s.sharedStoryGroupAccess.groupId}
		where ${s.sharedStoryGroupAccess.sharedStoryId} = ${s.sharedStory.id}
		  and ${s.userGroupMember.userId} = ${userId}
		  and ${inArray(s.sharedStoryGroupAccess.role, [...roles])}
		  and ${excludeLockedGroups(s.sharedStoryGroupAccess.groupId, lockedGroupIds)}
	)`;
}

/** Always-true when nothing is locked, so the common case adds no `not in` to the query. */
export function excludeLockedGroups(groupIdColumn: AnyColumn, lockedGroupIds: readonly string[]): SQL {
	return lockedGroupIds.length > 0 ? notInArray(groupIdColumn, [...lockedGroupIds]) : sql`1 = 1`;
}

async function listLockedGroupIdsOfSharedStory(sharedStoryId: string): Promise<string[]> {
	const [share] = await db
		.select({ projectId: s.sharedStory.projectId })
		.from(s.sharedStory)
		.where(eq(s.sharedStory.id, sharedStoryId))
		.execute();
	return share ? listLockedUserGroupIds(share.projectId) : [];
}

function querySharedStories(whereCondition: SQL): Promise<SharedStoryWithLatest[]> {
	const latestVersions = latestVersionsSubquery();
	const accessCounts = accessCountsSubquery();
	const groupAccessCounts = groupAccessCountsSubquery();

	return db
		.select({
			id: s.sharedStory.id,
			storyId: s.sharedStory.storyId,
			projectId: s.sharedStory.projectId,
			userId: s.sharedStory.userId,
			visibility: s.sharedStory.visibility,
			projectRole: s.sharedStory.projectRole,
			isPinned: s.sharedStory.isPinned,
			createdAt: s.sharedStory.createdAt,
			updatedAt: s.story.updatedAt,
			authorName: s.user.name,
			ownerUserId: sql<string>`coalesce(${s.chat.userId}, ${s.story.userId})`,
			chatId: s.story.chatId,
			slug: s.story.slug,
			title: s.story.title,
			format: s.story.format,
			code: s.storyVersion.code,
			storyVersionId: s.storyVersion.id,
			version: s.storyVersion.version,
			isLive: s.story.isLive,
			certifiedAt: s.story.certifiedAt,
			certifiedByName: storyCertifier.name,
			sharedWithCount: sql<number>`coalesce(${accessCounts.cnt}, 0)`,
			sharedWithGroupCount: sql<number>`coalesce(${groupAccessCounts.cnt}, 0)`,
		})
		.from(s.sharedStory)
		.innerJoin(s.story, eq(s.sharedStory.storyId, s.story.id))
		.leftJoin(s.chat, eq(s.story.chatId, s.chat.id))
		.innerJoin(s.user, eq(s.sharedStory.userId, s.user.id))
		.leftJoin(storyCertifier, eq(s.story.certifiedBy, storyCertifier.id))
		.innerJoin(latestVersions, eq(s.story.id, latestVersions.storyId))
		.innerJoin(
			s.storyVersion,
			and(eq(s.storyVersion.storyId, s.story.id), eq(s.storyVersion.version, latestVersions.maxVersion)),
		)
		.leftJoin(accessCounts, eq(accessCounts.sharedStoryId, s.sharedStory.id))
		.leftJoin(groupAccessCounts, eq(groupAccessCounts.sharedStoryId, s.sharedStory.id))
		.where(whereCondition)
		.orderBy(desc(s.sharedStory.createdAt))
		.execute();
}

function latestVersionsSubquery() {
	return db
		.select({
			storyId: s.storyVersion.storyId,
			maxVersion: max(s.storyVersion.version).as('max_version'),
		})
		.from(s.storyVersion)
		.groupBy(s.storyVersion.storyId)
		.as('latest');
}

function accessCountsSubquery() {
	return db
		.select({
			sharedStoryId: s.sharedStoryAccess.sharedStoryId,
			cnt: count(s.sharedStoryAccess.userId).as('cnt'),
		})
		.from(s.sharedStoryAccess)
		.groupBy(s.sharedStoryAccess.sharedStoryId)
		.as('access_counts');
}

function groupAccessCountsSubquery() {
	return db
		.select({
			sharedStoryId: s.sharedStoryGroupAccess.sharedStoryId,
			cnt: count(s.sharedStoryGroupAccess.groupId).as('group_cnt'),
		})
		.from(s.sharedStoryGroupAccess)
		.groupBy(s.sharedStoryGroupAccess.sharedStoryId)
		.as('group_access_counts');
}
