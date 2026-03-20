import { and, asc, desc, eq, isNull, max, or, sql } from 'drizzle-orm';

import s, { type DBStoryDataCache, type DBStoryVersion } from '../db/abstractSchema';
import { db } from '../db/db';

export async function createVersion(data: {
	chatId: string;
	storyId: string;
	title: string;
	code: string;
	action: 'create' | 'update' | 'replace';
	source: 'assistant' | 'user';
	isLive?: boolean;
	cacheTtlMinutes?: number | null;
}): Promise<DBStoryVersion> {
	const nextVersion = db
		.select({ v: sql<number>`coalesce(max(${s.storyVersion.version}), 0) + 1` })
		.from(s.storyVersion)
		.where(and(eq(s.storyVersion.chatId, data.chatId), eq(s.storyVersion.storyId, data.storyId)));

	const liveSettings = await resolveLiveSettings(data);

	const [created] = await db
		.insert(s.storyVersion)
		.values({
			chatId: data.chatId,
			storyId: data.storyId,
			title: data.title,
			code: data.code,
			action: data.action,
			source: data.source,
			version: sql`(${nextVersion})`,
			...liveSettings,
		})
		.returning()
		.execute();

	return created;
}

async function resolveLiveSettings(data: {
	chatId: string;
	storyId: string;
	isLive?: boolean;
}): Promise<{ isLive: boolean; cacheSchedule: string | null; refreshText: boolean }> {
	if (data.isLive !== undefined) {
		return { isLive: data.isLive, cacheSchedule: null, refreshText: false };
	}

	const latest = await getLatestVersion(data.chatId, data.storyId);
	if (latest) {
		return { isLive: latest.isLive, cacheSchedule: latest.cacheSchedule, refreshText: latest.refreshText };
	}

	return { isLive: false, cacheSchedule: null, refreshText: false };
}

export async function getLatestVersion(chatId: string, storyId: string): Promise<DBStoryVersion | null> {
	const [version] = await db
		.select()
		.from(s.storyVersion)
		.where(and(eq(s.storyVersion.chatId, chatId), eq(s.storyVersion.storyId, storyId)))
		.orderBy(desc(s.storyVersion.version))
		.limit(1)
		.execute();

	return version ?? null;
}

export async function listVersions(chatId: string, storyId: string): Promise<DBStoryVersion[]> {
	return db
		.select()
		.from(s.storyVersion)
		.where(and(eq(s.storyVersion.chatId, chatId), eq(s.storyVersion.storyId, storyId)))
		.orderBy(asc(s.storyVersion.version))
		.execute();
}

export async function listStoriesInChat(
	chatId: string,
): Promise<{ storyId: string; title: string; latestVersion: number }[]> {
	const rows = await db
		.select({
			storyId: s.storyVersion.storyId,
			title: s.storyVersion.title,
			version: s.storyVersion.version,
		})
		.from(s.storyVersion)
		.where(eq(s.storyVersion.chatId, chatId))
		.orderBy(asc(s.storyVersion.version))
		.execute();

	const latest = new Map<string, { title: string; version: number }>();
	for (const row of rows) {
		latest.set(row.storyId, { title: row.title, version: row.version });
	}

	return [...latest.entries()].map(([storyId, { title, version }]) => ({
		storyId,
		title,
		latestVersion: version,
	}));
}

export async function listUserStories(
	userId: string,
	options?: { archived?: boolean },
): Promise<{ storyId: string; chatId: string; title: string; code: string; createdAt: Date }[]> {
	const latestVersions = db
		.select({
			chatId: s.storyVersion.chatId,
			storyId: s.storyVersion.storyId,
			maxVersion: max(s.storyVersion.version).as('max_version'),
		})
		.from(s.storyVersion)
		.innerJoin(s.chat, eq(s.storyVersion.chatId, s.chat.id))
		.where(eq(s.chat.userId, userId))
		.groupBy(s.storyVersion.chatId, s.storyVersion.storyId)
		.as('latest');

	const archivedFilter = options?.archived
		? sql`${s.storyVersion.archivedAt} IS NOT NULL`
		: isNull(s.storyVersion.archivedAt);

	return db
		.select({
			storyId: s.storyVersion.storyId,
			chatId: s.storyVersion.chatId,
			title: s.storyVersion.title,
			code: s.storyVersion.code,
			createdAt: s.storyVersion.createdAt,
		})
		.from(s.storyVersion)
		.innerJoin(
			latestVersions,
			and(
				eq(s.storyVersion.chatId, latestVersions.chatId),
				eq(s.storyVersion.storyId, latestVersions.storyId),
				eq(s.storyVersion.version, latestVersions.maxVersion),
			),
		)
		.where(archivedFilter)
		.orderBy(desc(s.storyVersion.createdAt))
		.execute();
}

export async function archiveStory(chatId: string, storyId: string): Promise<void> {
	await db
		.update(s.storyVersion)
		.set({ archivedAt: new Date() })
		.where(and(eq(s.storyVersion.chatId, chatId), eq(s.storyVersion.storyId, storyId)))
		.execute();
}

export async function archiveMany(stories: { chatId: string; storyId: string }[]): Promise<void> {
	const conditions = stories.map(({ chatId, storyId }) =>
		and(eq(s.storyVersion.chatId, chatId), eq(s.storyVersion.storyId, storyId)),
	);

	await db
		.update(s.storyVersion)
		.set({ archivedAt: new Date() })
		.where(or(...conditions))
		.execute();
}

export async function unarchiveStory(chatId: string, storyId: string): Promise<void> {
	await db
		.update(s.storyVersion)
		.set({ archivedAt: null })
		.where(and(eq(s.storyVersion.chatId, chatId), eq(s.storyVersion.storyId, storyId)))
		.execute();
}

export async function updateLiveSettings(
	chatId: string,
	storyId: string,
	settings: { isLive: boolean; cacheSchedule: string | null; refreshText: boolean },
): Promise<void> {
	await db
		.update(s.storyVersion)
		.set({
			isLive: settings.isLive,
			cacheSchedule: settings.cacheSchedule,
			refreshText: settings.refreshText,
		})
		.where(and(eq(s.storyVersion.chatId, chatId), eq(s.storyVersion.storyId, storyId)))
		.execute();
}

export async function getStoryDataCache(chatId: string, storyId: string): Promise<DBStoryDataCache | null> {
	const [row] = await db
		.select()
		.from(s.storyDataCache)
		.where(and(eq(s.storyDataCache.chatId, chatId), eq(s.storyDataCache.storyId, storyId)))
		.execute();

	return row ?? null;
}

export async function upsertStoryDataCache(
	chatId: string,
	storyId: string,
	queryData: Record<string, { data: unknown[]; columns: string[] }>,
	regeneratedCode?: string | null,
): Promise<DBStoryDataCache> {
	const [row] = await db
		.insert(s.storyDataCache)
		.values({ chatId, storyId, queryData, regeneratedCode: regeneratedCode ?? null, cachedAt: new Date() })
		.onConflictDoUpdate({
			target: [s.storyDataCache.chatId, s.storyDataCache.storyId],
			set: { queryData, regeneratedCode: regeneratedCode ?? null, cachedAt: new Date() },
		})
		.returning()
		.execute();

	return row;
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
