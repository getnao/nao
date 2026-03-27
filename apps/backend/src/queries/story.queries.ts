import { and, asc, desc, eq, isNull, max, or, sql } from 'drizzle-orm';

import s, { type DBStory, type DBStoryDataCache, type DBStoryVersion } from '../db/abstractSchema';
import { db } from '../db/db';

export async function getStoryByChatAndSlug(chatId: string, slug: string): Promise<DBStory | null> {
	const [row] = await db
		.select()
		.from(s.story)
		.where(and(eq(s.story.chatId, chatId), eq(s.story.slug, slug)))
		.limit(1)
		.execute();

	return row ?? null;
}

export async function getOrCreateStory(data: { chatId: string; slug: string; title: string }): Promise<DBStory> {
	const existing = await getStoryByChatAndSlug(data.chatId, data.slug);
	if (existing) {
		return existing;
	}

	await db
		.insert(s.story)
		.values({ chatId: data.chatId, slug: data.slug, title: data.title })
		.onConflictDoNothing({ target: [s.story.chatId, s.story.slug] })
		.execute();

	const row = await getStoryByChatAndSlug(data.chatId, data.slug);
	if (!row) {
		throw new Error(`Failed to create or retrieve story: ${data.chatId}/${data.slug}`);
	}
	return row;
}

export async function createVersion(data: {
	chatId: string;
	slug: string;
	title: string;
	code: string;
	action: 'create' | 'update' | 'replace';
	source: 'assistant' | 'user';
}): Promise<DBStoryVersion & { title: string }> {
	const story = await getOrCreateStory({
		chatId: data.chatId,
		slug: data.slug,
		title: data.title,
	});

	if (story.title !== data.title) {
		await db.update(s.story).set({ title: data.title }).where(eq(s.story.id, story.id)).execute();
	}

	const nextVersion = db
		.select({ v: sql<number>`coalesce(max(${s.storyVersion.version}), 0) + 1` })
		.from(s.storyVersion)
		.where(eq(s.storyVersion.storyId, story.id));

	const [created] = await db
		.insert(s.storyVersion)
		.values({
			storyId: story.id,
			code: data.code,
			action: data.action,
			source: data.source,
			version: sql`(${nextVersion})`,
		})
		.returning()
		.execute();

	return { ...created, title: data.title };
}

export async function getLatestVersion(
	chatId: string,
	slug: string,
): Promise<
	| (DBStoryVersion &
			Pick<
				DBStory,
				'title' | 'isLive' | 'isLiveTextDynamic' | 'cacheSchedule' | 'cacheScheduleDescription' | 'archivedAt'
			>)
	| null
> {
	const [row] = await db
		.select({
			id: s.storyVersion.id,
			storyId: s.storyVersion.storyId,
			version: s.storyVersion.version,
			code: s.storyVersion.code,
			action: s.storyVersion.action,
			source: s.storyVersion.source,
			createdAt: s.storyVersion.createdAt,
			title: s.story.title,
			isLive: s.story.isLive,
			isLiveTextDynamic: s.story.isLiveTextDynamic,
			cacheSchedule: s.story.cacheSchedule,
			cacheScheduleDescription: s.story.cacheScheduleDescription,
			archivedAt: s.story.archivedAt,
		})
		.from(s.storyVersion)
		.innerJoin(s.story, eq(s.storyVersion.storyId, s.story.id))
		.where(and(eq(s.story.chatId, chatId), eq(s.story.slug, slug)))
		.orderBy(desc(s.storyVersion.version))
		.limit(1)
		.execute();

	return row ?? null;
}

export async function listVersions(chatId: string, slug: string): Promise<DBStoryVersion[]> {
	return db
		.select({
			id: s.storyVersion.id,
			storyId: s.storyVersion.storyId,
			version: s.storyVersion.version,
			code: s.storyVersion.code,
			action: s.storyVersion.action,
			source: s.storyVersion.source,
			createdAt: s.storyVersion.createdAt,
		})
		.from(s.storyVersion)
		.innerJoin(s.story, eq(s.storyVersion.storyId, s.story.id))
		.where(and(eq(s.story.chatId, chatId), eq(s.story.slug, slug)))
		.orderBy(asc(s.storyVersion.version))
		.execute();
}

export async function listStoriesInChat(
	chatId: string,
): Promise<{ slug: string; title: string; latestVersion: number }[]> {
	const stories = await db
		.select({
			slug: s.story.slug,
			title: s.story.title,
			latestVersion: max(s.storyVersion.version).as('latest_version'),
		})
		.from(s.story)
		.innerJoin(s.storyVersion, eq(s.storyVersion.storyId, s.story.id))
		.where(eq(s.story.chatId, chatId))
		.groupBy(s.story.id)
		.execute();

	return stories.map((row) => ({
		slug: row.slug,
		title: row.title,
		latestVersion: row.latestVersion ?? 1,
	}));
}

export async function listUserStories(
	userId: string,
	options?: { archived?: boolean },
): Promise<{ slug: string; chatId: string; title: string; code: string; createdAt: Date }[]> {
	const latestVersions = db
		.select({
			storyId: s.storyVersion.storyId,
			maxVersion: max(s.storyVersion.version).as('max_version'),
		})
		.from(s.storyVersion)
		.groupBy(s.storyVersion.storyId)
		.as('latest');

	const archivedFilter = options?.archived ? sql`${s.story.archivedAt} IS NOT NULL` : isNull(s.story.archivedAt);

	return db
		.select({
			slug: s.story.slug,
			chatId: s.story.chatId,
			title: s.story.title,
			code: s.storyVersion.code,
			createdAt: s.story.createdAt,
		})
		.from(s.story)
		.innerJoin(s.chat, eq(s.story.chatId, s.chat.id))
		.innerJoin(latestVersions, eq(s.story.id, latestVersions.storyId))
		.innerJoin(
			s.storyVersion,
			and(eq(s.storyVersion.storyId, s.story.id), eq(s.storyVersion.version, latestVersions.maxVersion)),
		)
		.where(and(eq(s.chat.userId, userId), archivedFilter))
		.orderBy(desc(s.story.createdAt))
		.execute();
}

export async function archiveStory(chatId: string, slug: string): Promise<void> {
	await db
		.update(s.story)
		.set({ archivedAt: new Date() })
		.where(and(eq(s.story.chatId, chatId), eq(s.story.slug, slug)))
		.execute();
}

export async function archiveMany(stories: { chatId: string; slug: string }[]): Promise<void> {
	if (stories.length === 0) {
		return;
	}

	const conditions = stories.map(({ chatId, slug }) => and(eq(s.story.chatId, chatId), eq(s.story.slug, slug)));

	await db
		.update(s.story)
		.set({ archivedAt: new Date() })
		.where(or(...conditions))
		.execute();
}

export async function unarchiveStory(chatId: string, slug: string): Promise<void> {
	await db
		.update(s.story)
		.set({ archivedAt: null })
		.where(and(eq(s.story.chatId, chatId), eq(s.story.slug, slug)))
		.execute();
}

export async function updateLiveSettings(
	chatId: string,
	slug: string,
	settings: {
		isLive: boolean;
		isLiveTextDynamic: boolean;
		cacheSchedule: string | null;
		cacheScheduleDescription: string | null;
	},
): Promise<void> {
	await db
		.update(s.story)
		.set(settings)
		.where(and(eq(s.story.chatId, chatId), eq(s.story.slug, slug)))
		.execute();
}

export async function getStoryDataCache(chatId: string, slug: string): Promise<DBStoryDataCache | null> {
	const [row] = await db
		.select({
			storyId: s.storyDataCache.storyId,
			queryData: s.storyDataCache.queryData,
			analysisResults: s.storyDataCache.analysisResults,
			cachedAt: s.storyDataCache.cachedAt,
		})
		.from(s.storyDataCache)
		.innerJoin(s.story, eq(s.storyDataCache.storyId, s.story.id))
		.where(and(eq(s.story.chatId, chatId), eq(s.story.slug, slug)))
		.execute();

	return row ?? null;
}

export async function upsertStoryDataCache(
	chatId: string,
	slug: string,
	queryData: Record<string, { data: unknown[]; columns: string[] }>,
	analysisResults?: Record<string, string> | null,
): Promise<DBStoryDataCache> {
	const story = await getStoryByChatAndSlug(chatId, slug);
	if (!story) {
		throw new Error(`Story not found: ${chatId}/${slug}`);
	}

	const [row] = await db
		.insert(s.storyDataCache)
		.values({
			storyId: story.id,
			queryData,
			analysisResults: analysisResults ?? null,
			cachedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: s.storyDataCache.storyId,
			set: {
				queryData,
				analysisResults: analysisResults ?? null,
				cachedAt: new Date(),
			},
		})
		.returning()
		.execute();

	return row;
}

export async function updateLatestVersionCode(chatId: string, slug: string, code: string): Promise<void> {
	const latest = await getLatestVersion(chatId, slug);
	if (!latest) {
		return;
	}

	await db
		.update(s.storyVersion)
		.set({ code })
		.where(and(eq(s.storyVersion.storyId, latest.storyId), eq(s.storyVersion.version, latest.version)))
		.execute();
}

export async function collectSqlQueries(
	chatId: string,
	code: string,
): Promise<Record<string, { sqlQuery: string; databaseId?: string }>> {
	const chartRegex = /<(?:chart|table)\s+[^>]*query_id="([^"]*)"[^>]*\/?>/g;
	const queryIds = new Set<string>();
	let match;
	while ((match = chartRegex.exec(code)) !== null) {
		queryIds.add(match[1]);
	}

	if (queryIds.size === 0) {
		return {};
	}

	return findSqlQueriesByIds(chatId, queryIds);
}

export async function findSqlQueryById(
	chatId: string,
	queryId: string,
): Promise<{ sqlQuery: string; databaseId?: string } | null> {
	const result = await findSqlQueriesByIds(chatId, new Set([queryId]));
	return result[queryId] ?? null;
}

async function findSqlQueriesByIds(
	chatId: string,
	queryIds: Set<string>,
): Promise<Record<string, { sqlQuery: string; databaseId?: string }>> {
	const parts = await db
		.select({ toolInput: s.messagePart.toolInput, toolOutput: s.messagePart.toolOutput })
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.messagePart.messageId, s.chatMessage.id))
		.where(and(eq(s.chatMessage.chatId, chatId), eq(s.messagePart.toolName, 'execute_sql')))
		.execute();

	const queries: Record<string, { sqlQuery: string; databaseId?: string }> = {};
	for (const part of parts) {
		const output = part.toolOutput as { id?: string } | null;
		const input = part.toolInput as { sql_query?: string; database_id?: string } | null;
		if (output?.id && queryIds.has(output.id) && input?.sql_query) {
			queries[output.id] = {
				sqlQuery: input.sql_query,
				...(input.database_id && { databaseId: input.database_id }),
			};
		}
	}

	return queries;
}
