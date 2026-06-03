import { and, count, desc, eq, isNull, max, or, type SQL, sql } from 'drizzle-orm';

import s, { type DBSharedStory } from '../db/abstractSchema';
import { db } from '../db/db';

export type SharedStoryWithLatest = DBSharedStory & {
	updatedAt: Date;
	authorName: string;
	chatId: string | null;
	slug: string;
	title: string;
	code: string;
	sharedWithCount: number;
};

export async function createSharedStory(
	data: Pick<DBSharedStory, 'storyId' | 'projectId' | 'userId' | 'visibility'>,
	allowedUserIds?: string[],
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
		await db.delete(s.sharedStoryAccess).where(eq(s.sharedStoryAccess.sharedStoryId, existing.id)).execute();
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

	if (data.visibility === 'specific' && allowedUserIds && allowedUserIds.length > 0) {
		const accessRows = allowedUserIds.map((userId) => ({
			sharedStoryId: saved.id,
			userId,
		}));
		await db.insert(s.sharedStoryAccess).values(accessRows).execute();
	}

	return saved;
}

export async function getSharedStory(id: string): Promise<SharedStoryWithLatest | null> {
	const [row] = await querySharedStories(eq(s.sharedStory.id, id));
	return row ?? null;
}

export async function canUserAccessSharedStory(sharedStoryId: string, userId: string): Promise<boolean> {
	const [row] = await db
		.select({ sharedStoryId: s.sharedStoryAccess.sharedStoryId })
		.from(s.sharedStoryAccess)
		.where(and(eq(s.sharedStoryAccess.sharedStoryId, sharedStoryId), eq(s.sharedStoryAccess.userId, userId)))
		.execute();
	return !!row;
}

export async function listUserSharedStories(
	projectIds: string[],
	userId: string,
	projectId: string,
): Promise<SharedStoryWithLatest[]> {
	if (!projectIds.includes(projectId)) {
		return [];
	}

	const hasUserAccess = sql`exists (
		select 1 from ${s.sharedStoryAccess}
		where ${s.sharedStoryAccess.sharedStoryId} = ${s.sharedStory.id}
		  and ${s.sharedStoryAccess.userId} = ${userId}
	)`;

	return querySharedStories(
		and(
			eq(s.sharedStory.projectId, projectId),
			isNull(s.story.archivedAt),
			or(eq(s.sharedStory.visibility, 'project'), eq(s.sharedStory.userId, userId), hasUserAccess),
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
	const chartRegex = /<(?:chart|table)\s+[^>]*query_id="([^"]*)"[^>]*\/?>/g;
	const queryIds = new Set<string>();
	let match;
	while ((match = chartRegex.exec(code)) !== null) {
		queryIds.add(match[1]);
	}

	if (queryIds.size === 0) {
		return null;
	}

	const parts = await db
		.select({ toolOutput: s.messagePart.toolOutput })
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.messagePart.messageId, s.chatMessage.id))
		.where(and(eq(s.chatMessage.chatId, chatId), eq(s.messagePart.toolName, 'execute_sql')))
		.execute();

	const data: Record<string, { data: unknown[]; columns: string[] }> = {};
	for (const part of parts) {
		const output = part.toolOutput as { id?: string; data?: unknown[]; columns?: string[] } | null;
		if (output?.id && queryIds.has(output.id)) {
			data[output.id] = {
				data: output.data ?? [],
				columns: output.columns ?? [],
			};
		}
	}

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

export async function getSharedStoryAllowedUserIds(sharedStoryId: string): Promise<string[]> {
	const rows = await db
		.select({ userId: s.sharedStoryAccess.userId })
		.from(s.sharedStoryAccess)
		.where(eq(s.sharedStoryAccess.sharedStoryId, sharedStoryId))
		.execute();

	return rows.map((r) => r.userId);
}

export async function updateSharedStoryAllowedUsers(sharedStoryId: string, userIds: string[]): Promise<void> {
	await db.delete(s.sharedStoryAccess).where(eq(s.sharedStoryAccess.sharedStoryId, sharedStoryId)).execute();

	if (userIds.length > 0) {
		const rows = userIds.map((userId) => ({ sharedStoryId, userId }));
		await db.insert(s.sharedStoryAccess).values(rows).execute();
	}
}

export async function deleteSharedStory(id: string): Promise<void> {
	await db.delete(s.sharedStory).where(eq(s.sharedStory.id, id)).execute();
}

function querySharedStories(whereCondition: SQL): Promise<SharedStoryWithLatest[]> {
	const latestVersions = latestVersionsSubquery();
	const accessCounts = accessCountsSubquery();

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
			code: s.storyVersion.code,
			sharedWithCount: sql<number>`coalesce(${accessCounts.cnt}, 0)`,
		})
		.from(s.sharedStory)
		.innerJoin(s.story, eq(s.sharedStory.storyId, s.story.id))
		.innerJoin(s.user, eq(s.sharedStory.userId, s.user.id))
		.innerJoin(latestVersions, eq(s.story.id, latestVersions.storyId))
		.innerJoin(
			s.storyVersion,
			and(eq(s.storyVersion.storyId, s.story.id), eq(s.storyVersion.version, latestVersions.maxVersion)),
		)
		.leftJoin(accessCounts, eq(accessCounts.sharedStoryId, s.sharedStory.id))
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
