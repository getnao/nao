import { type StorySharingInfo } from '@nao/shared/types';
import { and, asc, desc, eq, inArray, isNull, max, or, type SQL, sql } from 'drizzle-orm';

import s, { type DBStory, type DBStoryDataCache, type DBStoryVersion } from '../db/abstractSchema';
import { db, type DBExecutor } from '../db/db';

export type UserStoryRow = Pick<
	DBStory,
	| 'id'
	| 'chatId'
	| 'projectId'
	| 'userId'
	| 'slug'
	| 'title'
	| 'isLive'
	| 'isLiveTextDynamic'
	| 'cacheSchedule'
	| 'cacheScheduleDescription'
	| 'archivedAt'
	| 'createdAt'
	| 'updatedAt'
> & { code: string };

export async function getStoryByChatAndSlug(
	chatId: string,
	slug: string,
	executor: DBExecutor = db,
): Promise<DBStory | null> {
	const [row] = await executor
		.select()
		.from(s.story)
		.where(and(eq(s.story.chatId, chatId), eq(s.story.slug, slug)))
		.limit(1)
		.execute();

	return row ?? null;
}

export async function getStoryById(storyId: string): Promise<DBStory | null> {
	const [row] = await db.select().from(s.story).where(eq(s.story.id, storyId)).limit(1).execute();
	return row ?? null;
}

export async function getStoryProjectId(storyId: string): Promise<string | null> {
	const [row] = await db
		.select({
			storyProjectId: s.story.projectId,
			chatProjectId: s.chat.projectId,
		})
		.from(s.story)
		.leftJoin(s.chat, eq(s.story.chatId, s.chat.id))
		.where(eq(s.story.id, storyId))
		.limit(1)
		.execute();
	if (!row) {
		return null;
	}
	return row.chatProjectId ?? row.storyProjectId ?? null;
}

export async function getStoryOwnerId(storyId: string): Promise<string | undefined> {
	const [row] = await db
		.select({
			storyUserId: s.story.userId,
			chatUserId: s.chat.userId,
		})
		.from(s.story)
		.leftJoin(s.chat, eq(s.story.chatId, s.chat.id))
		.where(eq(s.story.id, storyId))
		.limit(1)
		.execute();

	return row?.chatUserId ?? row?.storyUserId ?? undefined;
}

export async function getStoryByIdForUser(storyId: string, userId: string): Promise<UserStoryRow | null> {
	const latestVersions = latestVersionsSubquery();

	const [row] = await db
		.select({
			id: s.story.id,
			chatId: s.story.chatId,
			projectId: s.story.projectId,
			userId: s.story.userId,
			slug: s.story.slug,
			title: s.story.title,
			isLive: s.story.isLive,
			isLiveTextDynamic: s.story.isLiveTextDynamic,
			cacheSchedule: s.story.cacheSchedule,
			cacheScheduleDescription: s.story.cacheScheduleDescription,
			archivedAt: s.story.archivedAt,
			createdAt: s.story.createdAt,
			updatedAt: s.story.updatedAt,
			code: s.storyVersion.code,
		})
		.from(s.story)
		.leftJoin(s.chat, eq(s.story.chatId, s.chat.id))
		.innerJoin(latestVersions, eq(s.story.id, latestVersions.storyId))
		.innerJoin(
			s.storyVersion,
			and(eq(s.storyVersion.storyId, s.story.id), eq(s.storyVersion.version, latestVersions.maxVersion)),
		)
		.where(
			and(
				eq(s.story.id, storyId),
				or(eq(s.chat.userId, userId), and(isNull(s.story.chatId), eq(s.story.userId, userId))),
			),
		)
		.limit(1)
		.execute();

	return row ?? null;
}

export async function getStandaloneStoryByUserAndSlug(
	userId: string,
	projectId: string,
	slug: string,
): Promise<DBStory | null> {
	const [row] = await db
		.select()
		.from(s.story)
		.where(
			and(
				eq(s.story.projectId, projectId),
				eq(s.story.userId, userId),
				eq(s.story.slug, slug),
				isNull(s.story.chatId),
			),
		)
		.limit(1)
		.execute();

	return row ?? null;
}

export function listUserChatStories(
	userId: string,
	options?: { archived?: boolean; projectId?: string },
): Promise<UserStoryRow[]> {
	const condition =
		options?.projectId !== undefined
			? and(eq(s.chat.userId, userId), eq(s.chat.projectId, options.projectId))!
			: eq(s.chat.userId, userId);
	return queryStoriesWithLatestVersion(condition, options);
}

export function listUserStandaloneStories(
	userId: string,
	projectId: string,
	options?: { archived?: boolean; limit?: number },
): Promise<UserStoryRow[]> {
	const limit = Math.min(options?.limit ?? 50, 200);
	return queryStoriesWithLatestVersion(
		and(eq(s.story.projectId, projectId), eq(s.story.userId, userId), isNull(s.story.chatId))!,
		{ ...options, limit },
	);
}

export function listAllUserStoriesInProject(
	userId: string,
	projectId: string,
	options?: { archived?: boolean; limit?: number },
): Promise<UserStoryRow[]> {
	const limit = Math.min(options?.limit ?? 20, 100);
	return queryStoriesWithLatestVersion(
		or(
			and(eq(s.chat.projectId, projectId), eq(s.chat.userId, userId)),
			and(eq(s.story.projectId, projectId), eq(s.story.userId, userId), isNull(s.story.chatId)),
		)!,
		{ ...options, limit },
	);
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

export async function createStoryVersion(
	data: {
		chatId: string;
		slug: string;
		title: string;
		code: string;
		action: 'create' | 'update' | 'replace';
		source: 'assistant' | 'user';
	},
	executor: DBExecutor = db,
): Promise<DBStoryVersion & { title: string }> {
	const story = await getOrCreateStory({ chatId: data.chatId, slug: data.slug, title: data.title }, executor);

	if (story.title !== data.title) {
		await executor.update(s.story).set({ title: data.title }).where(eq(s.story.id, story.id)).execute();
	}

	const nextVersion = executor
		.select({ v: sql<number>`coalesce(max(${s.storyVersion.version}), 0) + 1` })
		.from(s.storyVersion)
		.where(eq(s.storyVersion.storyId, story.id));

	const [created] = await executor
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

export async function createStandaloneVersion(data: {
	userId: string;
	projectId: string;
	slug: string;
	title: string;
	code: string;
	action: 'create' | 'update' | 'replace';
	source: 'assistant' | 'user';
}): Promise<DBStoryVersion & { title: string }> {
	const story = await getOrCreateStandaloneStory({
		userId: data.userId,
		projectId: data.projectId,
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

export async function createStandaloneStory(data: {
	userId: string;
	projectId: string;
	slug: string;
	title: string;
	code: string;
	source: 'assistant' | 'user';
}): Promise<{ id: string; slug: string; title: string; createdAt: Date; version: number } | null> {
	return db.transaction(async (tx) => {
		const [story] = await tx
			.insert(s.story)
			.values({
				projectId: data.projectId,
				userId: data.userId,
				slug: data.slug,
				title: data.title,
			})
			.onConflictDoNothing()
			.returning()
			.execute();

		if (!story) {
			return null;
		}

		const [version] = await tx
			.insert(s.storyVersion)
			.values({
				storyId: story.id,
				code: data.code,
				action: 'create',
				source: data.source,
				version: 1,
			})
			.returning()
			.execute();

		return {
			id: story.id,
			slug: story.slug,
			title: story.title,
			createdAt: story.createdAt,
			version: version.version,
		};
	});
}

export async function deleteStory(storyId: string): Promise<void> {
	await db.delete(s.story).where(eq(s.story.id, storyId)).execute();
}

export async function assignChatToStory(storyId: string, chatId: string): Promise<void> {
	await db.update(s.story).set({ chatId }).where(eq(s.story.id, storyId)).execute();
}

export async function archiveStory(chatId: string, slug: string): Promise<void> {
	const matcher = and(eq(s.story.chatId, chatId), eq(s.story.slug, slug));
	await db.update(s.story).set({ archivedAt: new Date() }).where(matcher).execute();
	const ids = await db.select({ id: s.story.id }).from(s.story).where(matcher).execute();
	await detachStoriesFromFolders(ids.map((row) => row.id));
}

export async function archiveManyStories(stories: { chatId: string; slug: string }[]): Promise<void> {
	if (stories.length === 0) {
		return;
	}

	const conditions = stories.map(({ chatId, slug }) => and(eq(s.story.chatId, chatId), eq(s.story.slug, slug)));
	const matcher = or(...conditions);

	await db.update(s.story).set({ archivedAt: new Date() }).where(matcher).execute();
	const ids = await db.select({ id: s.story.id }).from(s.story).where(matcher).execute();
	await detachStoriesFromFolders(ids.map((row) => row.id));
}

export async function unarchiveStory(chatId: string, slug: string): Promise<void> {
	await db
		.update(s.story)
		.set({ archivedAt: null })
		.where(and(eq(s.story.chatId, chatId), eq(s.story.slug, slug)))
		.execute();
}

export async function archiveByStoryId(storyId: string): Promise<void> {
	await db.update(s.story).set({ archivedAt: new Date() }).where(eq(s.story.id, storyId)).execute();
	await detachStoriesFromFolders([storyId]);
}

export async function unarchiveByStoryId(storyId: string): Promise<void> {
	await db.update(s.story).set({ archivedAt: null }).where(eq(s.story.id, storyId)).execute();
}

async function detachStoriesFromFolders(storyIds: string[]): Promise<void> {
	if (storyIds.length === 0) {
		return;
	}
	await db.delete(s.storyFolderItem).where(inArray(s.storyFolderItem.storyId, storyIds)).execute();
}

export async function canUserAccessStory(storyId: string, userId: string): Promise<boolean> {
	const [owned] = await db
		.select({ id: s.story.id })
		.from(s.story)
		.leftJoin(s.chat, eq(s.story.chatId, s.chat.id))
		.where(
			and(
				eq(s.story.id, storyId),
				or(eq(s.chat.userId, userId), and(isNull(s.story.chatId), eq(s.story.userId, userId))),
			),
		)
		.limit(1)
		.execute();

	if (owned) {
		return true;
	}

	const isProjectMember = sql`exists (
		select 1 from ${s.projectMember}
		where ${s.projectMember.projectId} = ${s.sharedStory.projectId}
		  and ${s.projectMember.userId} = ${userId}
	)`;
	const isOrgMember = sql`exists (
		select 1 from ${s.orgMember}
		where ${s.orgMember.orgId} = ${s.project.orgId}
		  and ${s.orgMember.userId} = ${userId}
	)`;

	const [shared] = await db
		.select({ id: s.sharedStory.id })
		.from(s.sharedStory)
		.innerJoin(s.project, eq(s.project.id, s.sharedStory.projectId))
		.leftJoin(
			s.sharedStoryAccess,
			and(eq(s.sharedStoryAccess.sharedStoryId, s.sharedStory.id), eq(s.sharedStoryAccess.userId, userId)),
		)
		.where(
			and(
				eq(s.sharedStory.storyId, storyId),
				or(
					eq(s.sharedStory.userId, userId),
					and(eq(s.sharedStory.visibility, 'project'), or(isProjectMember, isOrgMember)),
					and(eq(s.sharedStory.visibility, 'specific'), sql`${s.sharedStoryAccess.userId} IS NOT NULL`),
				),
			),
		)
		.limit(1)
		.execute();

	return !!shared;
}

export async function updateStoryLiveSettings(
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

type StoryVersionWithStory = DBStoryVersion &
	Pick<
		DBStory,
		| 'title'
		| 'slug'
		| 'chatId'
		| 'isLive'
		| 'isLiveTextDynamic'
		| 'cacheSchedule'
		| 'cacheScheduleDescription'
		| 'archivedAt'
		| 'title'
		| 'slug'
		| 'chatId'
		| 'isLive'
		| 'isLiveTextDynamic'
		| 'cacheSchedule'
		| 'cacheScheduleDescription'
		| 'archivedAt'
	>;

export function getLatestVersionByChatAndSlug(chatId: string, slug: string): Promise<StoryVersionWithStory | null> {
	return getStoryVersion(and(eq(s.story.chatId, chatId), eq(s.story.slug, slug))!, { latest: true });
}

export function getLatestVersionByStoryId(storyId: string): Promise<StoryVersionWithStory | null> {
	return getStoryVersion(eq(s.story.id, storyId), { latest: true });
}

export function getVersionByNumber(
	chatId: string,
	slug: string,
	versionNumber: number,
): Promise<StoryVersionWithStory | null> {
	return getStoryVersion(
		and(eq(s.story.chatId, chatId), eq(s.story.slug, slug), eq(s.storyVersion.version, versionNumber))!,
	);
}

export async function listStoryVersions(chatId: string, slug: string): Promise<DBStoryVersion[]> {
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

export async function updateLatestVersionCode(chatId: string, slug: string, code: string): Promise<void> {
	const latest = await getLatestVersionByChatAndSlug(chatId, slug);
	if (!latest) {
		return;
	}

	await db
		.update(s.storyVersion)
		.set({ code })
		.where(and(eq(s.storyVersion.storyId, latest.storyId), eq(s.storyVersion.version, latest.version)))
		.execute();
}

export function getStoryDataCacheByChatAndSlug(chatId: string, slug: string): Promise<DBStoryDataCache | null> {
	return getStoryDataCache(and(eq(s.story.chatId, chatId), eq(s.story.slug, slug))!);
}

export function getStoryDataCacheByStoryId(storyId: string): Promise<DBStoryDataCache | null> {
	return getStoryDataCache(eq(s.story.id, storyId));
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

export async function upsertStoryDataCacheByStoryId(
	storyId: string,
	queryData: Record<string, { data: unknown[]; columns: string[] }>,
): Promise<void> {
	await db
		.insert(s.storyDataCache)
		.values({ storyId, queryData, cachedAt: new Date() })
		.onConflictDoUpdate({
			target: s.storyDataCache.storyId,
			set: { queryData, cachedAt: new Date() },
		})
		.execute();
}

export async function getSqlQueriesFromCode(
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

	return getSqlQueriesByIds(chatId, queryIds);
}

export async function getSqlQueryById(
	chatId: string,
	queryId: string,
): Promise<{ sqlQuery: string; databaseId?: string } | null> {
	const result = await getSqlQueriesByIds(chatId, new Set([queryId]));
	return result[queryId] ?? null;
}

async function queryStoriesWithLatestVersion(
	whereCondition: SQL,
	options?: { archived?: boolean; limit?: number },
): Promise<UserStoryRow[]> {
	const latestVersions = latestVersionsSubquery();

	const query = db
		.select({
			id: s.story.id,
			chatId: s.story.chatId,
			projectId: s.story.projectId,
			userId: s.story.userId,
			slug: s.story.slug,
			title: s.story.title,
			isLive: s.story.isLive,
			isLiveTextDynamic: s.story.isLiveTextDynamic,
			cacheSchedule: s.story.cacheSchedule,
			cacheScheduleDescription: s.story.cacheScheduleDescription,
			archivedAt: s.story.archivedAt,
			createdAt: s.story.createdAt,
			updatedAt: s.story.updatedAt,
			code: s.storyVersion.code,
		})
		.from(s.story)
		.leftJoin(s.chat, eq(s.story.chatId, s.chat.id))
		.innerJoin(latestVersions, eq(s.story.id, latestVersions.storyId))
		.innerJoin(
			s.storyVersion,
			and(eq(s.storyVersion.storyId, s.story.id), eq(s.storyVersion.version, latestVersions.maxVersion)),
		)
		.where(and(whereCondition, archivedStoryFilter(options?.archived)))
		.orderBy(desc(s.story.createdAt));

	if (options?.limit !== undefined) {
		return query.limit(options.limit).execute();
	}
	return query.execute();
}

async function getOrCreateStory(
	data: { chatId: string; slug: string; title: string },
	executor: DBExecutor = db,
): Promise<DBStory> {
	const existing = await getStoryByChatAndSlug(data.chatId, data.slug, executor);
	if (existing) {
		return existing;
	}

	await executor
		.insert(s.story)
		.values({ chatId: data.chatId, slug: data.slug, title: data.title })
		.onConflictDoNothing({ target: [s.story.chatId, s.story.slug] })
		.execute();

	const row = await getStoryByChatAndSlug(data.chatId, data.slug, executor);
	if (!row) {
		throw new Error(`Failed to create or retrieve story: ${data.chatId}/${data.slug}`);
	}
	return row;
}

async function getOrCreateStandaloneStory(data: {
	userId: string;
	projectId: string;
	slug: string;
	title: string;
}): Promise<DBStory> {
	const existing = await getStandaloneStoryByUserAndSlug(data.userId, data.projectId, data.slug);
	if (existing) {
		return existing;
	}

	await db
		.insert(s.story)
		.values({ projectId: data.projectId, userId: data.userId, slug: data.slug, title: data.title })
		.onConflictDoNothing()
		.execute();

	const row = await getStandaloneStoryByUserAndSlug(data.userId, data.projectId, data.slug);
	if (!row) {
		throw new Error(`Failed to create or retrieve standalone story: ${data.userId}/${data.projectId}/${data.slug}`);
	}
	return row;
}

async function getSqlQueriesByIds(
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

async function getStoryVersion(
	whereCondition: SQL,
	options?: { latest?: boolean },
): Promise<StoryVersionWithStory | null> {
	const query = db
		.select({
			id: s.storyVersion.id,
			storyId: s.storyVersion.storyId,
			version: s.storyVersion.version,
			code: s.storyVersion.code,
			action: s.storyVersion.action,
			source: s.storyVersion.source,
			createdAt: s.storyVersion.createdAt,
			title: s.story.title,
			slug: s.story.slug,
			chatId: s.story.chatId,
			isLive: s.story.isLive,
			isLiveTextDynamic: s.story.isLiveTextDynamic,
			cacheSchedule: s.story.cacheSchedule,
			cacheScheduleDescription: s.story.cacheScheduleDescription,
			archivedAt: s.story.archivedAt,
		})
		.from(s.storyVersion)
		.innerJoin(s.story, eq(s.storyVersion.storyId, s.story.id))
		.where(whereCondition);

	const ordered = options?.latest ? query.orderBy(desc(s.storyVersion.version)) : query;
	const [row] = await ordered.limit(1).execute();

	return row ?? null;
}

async function getStoryDataCache(whereCondition: SQL): Promise<DBStoryDataCache | null> {
	const [row] = await db
		.select({
			storyId: s.storyDataCache.storyId,
			queryData: s.storyDataCache.queryData,
			analysisResults: s.storyDataCache.analysisResults,
			cachedAt: s.storyDataCache.cachedAt,
		})
		.from(s.storyDataCache)
		.innerJoin(s.story, eq(s.storyDataCache.storyId, s.story.id))
		.where(whereCondition)
		.execute();

	return row ?? null;
}

export async function getStorySharingInfo(storyIds: string[]): Promise<Map<string, StorySharingInfo>> {
	if (storyIds.length === 0) {
		return new Map();
	}

	const rows = await db
		.select({
			storyId: s.sharedStory.storyId,
			visibility: s.sharedStory.visibility,
			isPinned: s.sharedStory.isPinned,
			sharedWithCount: sql<number>`count(${s.sharedStoryAccess.userId})`.mapWith(Number),
		})
		.from(s.sharedStory)
		.leftJoin(s.sharedStoryAccess, eq(s.sharedStoryAccess.sharedStoryId, s.sharedStory.id))
		.where(inArray(s.sharedStory.storyId, storyIds))
		.groupBy(s.sharedStory.id)
		.execute();

	const result = new Map<string, StorySharingInfo>();
	for (const row of rows) {
		result.set(row.storyId, {
			visibility: row.visibility,
			sharedWithCount: row.sharedWithCount,
			isPinned: row.isPinned,
		});
	}
	return result;
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

function archivedStoryFilter(archived: boolean | undefined): SQL {
	return archived ? sql`${s.story.archivedAt} IS NOT NULL` : isNull(s.story.archivedAt);
}
