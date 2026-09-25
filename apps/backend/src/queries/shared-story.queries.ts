import { extractQueryIds } from '@nao/shared/story-segments';
import type { StoryFormat } from '@nao/shared/types';
import { aliasedTable, and, count, desc, eq, isNull, max, or, type SQL, sql } from 'drizzle-orm';

import s, { type DBSharedStory } from '../db/abstractSchema';
import { db } from '../db/db';
import * as executeSqlQueries from './execute-sql.queries';

const storyCertifier = aliasedTable(s.user, 'story_certifier');

export type SharedStoryWithLatest = DBSharedStory & {
	updatedAt: Date;
	authorName: string;
	chatId: string | null;
	slug: string;
	title: string;
	format: StoryFormat;
	code: string;
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

export async function canUserAccessSharedStory(sharedStoryId: string, userId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: s.sharedStory.id })
		.from(s.sharedStory)
		.where(and(eq(s.sharedStory.id, sharedStoryId), sharedStoryGrantsUser(userId)))
		.limit(1)
		.execute();
	return !!row;
}

/** Matches `shared_story` rows granted to the user directly or through one of their user groups. */
export function sharedStoryGrantsUser(userId: string): SQL {
	return sql`(exists (
		select 1 from ${s.sharedStoryAccess}
		where ${s.sharedStoryAccess.sharedStoryId} = ${s.sharedStory.id}
		  and ${s.sharedStoryAccess.userId} = ${userId}
	) or exists (
		select 1 from ${s.sharedStoryGroupAccess}
		inner join ${s.userGroupMember} on ${s.userGroupMember.groupId} = ${s.sharedStoryGroupAccess.groupId}
		where ${s.sharedStoryGroupAccess.sharedStoryId} = ${s.sharedStory.id}
		  and ${s.userGroupMember.userId} = ${userId}
	))`;
}

export async function listUserSharedStories(
	projectIds: string[],
	userId: string,
	projectId: string,
): Promise<SharedStoryWithLatest[]> {
	if (!projectIds.includes(projectId)) {
		return [];
	}

	return querySharedStories(
		and(
			eq(s.sharedStory.projectId, projectId),
			isNull(s.story.archivedAt),
			or(
				eq(s.sharedStory.visibility, 'project'),
				eq(s.sharedStory.userId, userId),
				sharedStoryGrantsUser(userId),
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
): Promise<{ id: string; visibility: string } | null> {
	const [row] = await db
		.select({ id: s.sharedStory.id, visibility: s.sharedStory.visibility })
		.from(s.sharedStory)
		.where(and(eq(s.sharedStory.storyId, storyId), eq(s.sharedStory.projectId, projectId)))
		.limit(1)
		.execute();

	return row ?? null;
}

export async function getSharedStoryVisibilityById(sharedStoryId: string): Promise<{ visibility: string } | null> {
	const [row] = await db
		.select({ visibility: s.sharedStory.visibility })
		.from(s.sharedStory)
		.where(eq(s.sharedStory.id, sharedStoryId))
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

export async function getSharedStoryAllowedUserIds(sharedStoryId: string): Promise<string[]> {
	const rows = await db
		.select({ userId: s.sharedStoryAccess.userId })
		.from(s.sharedStoryAccess)
		.where(eq(s.sharedStoryAccess.sharedStoryId, sharedStoryId))
		.execute();

	return rows.map((r) => r.userId);
}

export async function getSharedStoryAllowedGroupIds(sharedStoryId: string): Promise<string[]> {
	const rows = await db
		.select({ groupId: s.sharedStoryGroupAccess.groupId })
		.from(s.sharedStoryGroupAccess)
		.where(eq(s.sharedStoryGroupAccess.sharedStoryId, sharedStoryId))
		.execute();

	return rows.map((r) => r.groupId);
}

/** Users granted directly plus the current members of every granted user group. */
export async function getSharedStoryRecipientUserIds(sharedStoryId: string): Promise<string[]> {
	const [directUserIds, groupMembers] = await Promise.all([
		getSharedStoryAllowedUserIds(sharedStoryId),
		db
			.selectDistinct({ userId: s.userGroupMember.userId })
			.from(s.sharedStoryGroupAccess)
			.innerJoin(s.userGroupMember, eq(s.userGroupMember.groupId, s.sharedStoryGroupAccess.groupId))
			.where(eq(s.sharedStoryGroupAccess.sharedStoryId, sharedStoryId))
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
			isPinned: s.sharedStory.isPinned,
			createdAt: s.sharedStory.createdAt,
			updatedAt: s.story.updatedAt,
			authorName: s.user.name,
			chatId: s.story.chatId,
			slug: s.story.slug,
			title: s.story.title,
			format: s.story.format,
			code: s.storyVersion.code,
			version: s.storyVersion.version,
			isLive: s.story.isLive,
			certifiedAt: s.story.certifiedAt,
			certifiedByName: storyCertifier.name,
			sharedWithCount: sql<number>`coalesce(${accessCounts.cnt}, 0)`,
			sharedWithGroupCount: sql<number>`coalesce(${groupAccessCounts.cnt}, 0)`,
		})
		.from(s.sharedStory)
		.innerJoin(s.story, eq(s.sharedStory.storyId, s.story.id))
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
