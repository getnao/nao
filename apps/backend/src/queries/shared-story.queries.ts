import { and, desc, eq, max } from 'drizzle-orm';

import s, { type DBSharedStory } from '../db/abstractSchema';
import { db } from '../db/db';

export type SharedStoryWithLatest = DBSharedStory & {
	authorName: string;
	chatId: string;
	slug: string;
	title: string;
	code: string;
};

export async function createSharedStory(
	data: Pick<DBSharedStory, 'storyId' | 'projectId' | 'userId' | 'visibility'>,
	allowedUserIds?: string[],
): Promise<DBSharedStory> {
	const [created] = await db.insert(s.sharedStory).values(data).returning().execute();

	if (data.visibility === 'specific' && allowedUserIds && allowedUserIds.length > 0) {
		const accessRows = allowedUserIds.map((userId) => ({
			sharedStoryId: created.id,
			userId,
		}));
		await db.insert(s.sharedStoryAccess).values(accessRows).execute();
	}

	return created;
}

export async function getSharedStory(id: string): Promise<SharedStoryWithLatest | null> {
	const latestVersions = db
		.select({
			storyId: s.storyVersion.storyId,
			maxVersion: max(s.storyVersion.version).as('max_version'),
		})
		.from(s.storyVersion)
		.groupBy(s.storyVersion.storyId)
		.as('latest');

	const [row] = await db
		.select({
			id: s.sharedStory.id,
			storyId: s.sharedStory.storyId,
			projectId: s.sharedStory.projectId,
			userId: s.sharedStory.userId,
			visibility: s.sharedStory.visibility,
			createdAt: s.sharedStory.createdAt,
			authorName: s.user.name,
			chatId: s.story.chatId,
			slug: s.story.slug,
			title: s.story.title,
			code: s.storyVersion.code,
		})
		.from(s.sharedStory)
		.innerJoin(s.story, eq(s.sharedStory.storyId, s.story.id))
		.innerJoin(s.user, eq(s.sharedStory.userId, s.user.id))
		.innerJoin(latestVersions, eq(s.story.id, latestVersions.storyId))
		.innerJoin(
			s.storyVersion,
			and(eq(s.storyVersion.storyId, s.story.id), eq(s.storyVersion.version, latestVersions.maxVersion)),
		)
		.where(eq(s.sharedStory.id, id))
		.execute();

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

export async function listProjectSharedStories(projectId: string, userId: string): Promise<SharedStoryWithLatest[]> {
	const latestVersions = db
		.select({
			storyId: s.storyVersion.storyId,
			maxVersion: max(s.storyVersion.version).as('max_version'),
		})
		.from(s.storyVersion)
		.groupBy(s.storyVersion.storyId)
		.as('latest');

	const allStories = await db
		.select({
			id: s.sharedStory.id,
			storyId: s.sharedStory.storyId,
			projectId: s.sharedStory.projectId,
			userId: s.sharedStory.userId,
			visibility: s.sharedStory.visibility,
			createdAt: s.sharedStory.createdAt,
			authorName: s.user.name,
			chatId: s.story.chatId,
			slug: s.story.slug,
			title: s.story.title,
			code: s.storyVersion.code,
		})
		.from(s.sharedStory)
		.innerJoin(s.story, eq(s.sharedStory.storyId, s.story.id))
		.innerJoin(s.user, eq(s.sharedStory.userId, s.user.id))
		.innerJoin(latestVersions, eq(s.story.id, latestVersions.storyId))
		.innerJoin(
			s.storyVersion,
			and(eq(s.storyVersion.storyId, s.story.id), eq(s.storyVersion.version, latestVersions.maxVersion)),
		)
		.where(eq(s.sharedStory.projectId, projectId))
		.orderBy(desc(s.sharedStory.createdAt))
		.execute();

	const specificStoryIds = allStories
		.filter((story) => story.visibility === 'specific' && story.userId !== userId)
		.map((story) => story.id);

	if (specificStoryIds.length === 0) {
		return allStories;
	}

	const accessRows = await db
		.select({ sharedStoryId: s.sharedStoryAccess.sharedStoryId })
		.from(s.sharedStoryAccess)
		.where(eq(s.sharedStoryAccess.userId, userId))
		.execute();

	const accessibleIds = new Set(accessRows.map((r) => r.sharedStoryId));

	return allStories.filter((story) => {
		if (story.visibility === 'project') {
			return true;
		}
		if (story.userId === userId) {
			return true;
		}
		return accessibleIds.has(story.id);
	});
}

export async function collectQueryData(
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

export async function findByStory(storyId: string, userId: string): Promise<{ id: string; visibility: string } | null> {
	const [row] = await db
		.select({ id: s.sharedStory.id, visibility: s.sharedStory.visibility })
		.from(s.sharedStory)
		.where(and(eq(s.sharedStory.storyId, storyId), eq(s.sharedStory.userId, userId)))
		.orderBy(desc(s.sharedStory.createdAt))
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

export async function updateAllowedUsers(sharedStoryId: string, userIds: string[]): Promise<void> {
	await db.delete(s.sharedStoryAccess).where(eq(s.sharedStoryAccess.sharedStoryId, sharedStoryId)).execute();

	if (userIds.length > 0) {
		const rows = userIds.map((userId) => ({ sharedStoryId, userId }));
		await db.insert(s.sharedStoryAccess).values(rows).execute();
	}
}

export async function deleteSharedStory(id: string): Promise<void> {
	await db.delete(s.sharedStory).where(eq(s.sharedStory.id, id)).execute();
}
