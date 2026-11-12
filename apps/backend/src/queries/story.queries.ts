import { extractQueryIds } from '@nao/shared/story-segments';
import { type StorySharingInfo, type StoryVersionOrigin } from '@nao/shared/types';
import { aliasedTable, and, asc, countDistinct, desc, eq, inArray, isNull, max, or, type SQL, sql } from 'drizzle-orm';

import s, {
	type DBStory,
	type DBStoryDataCache,
	type DBStoryVersion,
	type DBStoryViewerDataCache,
} from '../db/abstractSchema';
import { db, type DBExecutor } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import type { StoryQuerySources } from '../types/story-cache';
import { getOpenProjectIds } from '../utils/open-projects';
import { isQuickQuestionForkType } from './chat.queries';
import * as executeSqlQueries from './execute-sql.queries';
import { listLockedUserGroupIdsOfMember } from './locked-user-groups';
import { sharedStoryGrantsUser } from './shared-story.queries';

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
	| 'certifiedAt'
	| 'format'
	| 'createdAt'
	| 'updatedAt'
> & {
	code: string;
	version: number;
	versionCreatedAt: DBStoryVersion['createdAt'];
	certifiedByName: string | null;
};

const storyCertifier = aliasedTable(s.user, 'story_certifier');

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

export function listCustomStoriesInChat(chatId: string, executor: DBExecutor = db): Promise<DBStory[]> {
	return executor
		.select()
		.from(s.story)
		.where(and(eq(s.story.chatId, chatId), eq(s.story.format, 'custom')))
		.orderBy(asc(s.story.slug))
		.execute();
}

/** A story lives in its chat, or stands alone in its owner's project. */
export type StoryOwnership = { chatId: string } | { projectId: string; userId: string };

export async function createCustomStory(
	data: StoryOwnership & { slug: string; title: string },
	executor: DBExecutor = db,
): Promise<DBStory> {
	const [row] = await executor
		.insert(s.story)
		.values({ ...data, format: 'custom' })
		.returning()
		.execute();
	return row;
}

export async function getStoryById(storyId: string): Promise<DBStory | null> {
	const [row] = await db.select().from(s.story).where(eq(s.story.id, storyId)).limit(1).execute();
	return row ?? null;
}

export async function renameStory(storyId: string, title: string): Promise<void> {
	await db.update(s.story).set({ title }).where(eq(s.story.id, storyId)).execute();
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

export async function getProjectViewerCacheRevision(projectId: string): Promise<number> {
	const [project] = await db
		.select({ revision: s.project.viewerCacheRevision })
		.from(s.project)
		.where(eq(s.project.id, projectId))
		.limit(1)
		.execute();
	return project?.revision ?? 0;
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

export type StoryOwner = { id: string; name: string; email: string };

export async function getStoryOwner(storyId: string): Promise<StoryOwner | null> {
	const ownerId = await getStoryOwnerId(storyId);
	if (!ownerId) {
		return null;
	}
	const [row] = await db
		.select({ id: s.user.id, name: s.user.name, email: s.user.email })
		.from(s.user)
		.where(eq(s.user.id, ownerId))
		.limit(1)
		.execute();
	return row ?? null;
}

export async function getStoryByIdForUser(storyId: string, userId: string): Promise<UserStoryRow | null> {
	const latestVersions = latestVersionsSubquery();

	const [row] = await db
		.select({
			id: s.story.id,
			chatId: s.story.chatId,
			projectId: sql<string>`coalesce(${s.story.projectId}, ${s.chat.projectId})`,
			userId: s.story.userId,
			slug: s.story.slug,
			title: s.story.title,
			isLive: s.story.isLive,
			isLiveTextDynamic: s.story.isLiveTextDynamic,
			cacheSchedule: s.story.cacheSchedule,
			cacheScheduleDescription: s.story.cacheScheduleDescription,
			archivedAt: s.story.archivedAt,
			certifiedAt: s.story.certifiedAt,
			certifiedByName: storyCertifier.name,
			format: s.story.format,
			createdAt: s.story.createdAt,
			updatedAt: s.story.updatedAt,
			code: s.storyVersion.code,
			version: s.storyVersion.version,
			versionCreatedAt: s.storyVersion.createdAt,
		})
		.from(s.story)
		.leftJoin(s.chat, eq(s.story.chatId, s.chat.id))
		.leftJoin(storyCertifier, eq(s.story.certifiedBy, storyCertifier.id))
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

export type ChatStoryLatestVersion = Pick<DBStory, 'slug' | 'title' | 'format' | 'archivedAt'> & {
	storyId: string;
	version: number | null;
	code: string | null;
	source: DBStoryVersion['source'] | null;
};

/** Every story of a chat, archived included, with its latest version; a never-published custom draft has none. */
export async function listLatestVersionsInChat(chatId: string): Promise<ChatStoryLatestVersion[]> {
	const latest = db
		.select({
			storyId: s.storyVersion.storyId,
			maxVersion: max(s.storyVersion.version).as('max_version'),
		})
		.from(s.storyVersion)
		.innerJoin(s.story, eq(s.storyVersion.storyId, s.story.id))
		.where(eq(s.story.chatId, chatId))
		.groupBy(s.storyVersion.storyId)
		.as('latest');

	return db
		.select({
			storyId: s.story.id,
			slug: s.story.slug,
			title: s.story.title,
			format: s.story.format,
			archivedAt: s.story.archivedAt,
			version: s.storyVersion.version,
			code: s.storyVersion.code,
			source: s.storyVersion.source,
		})
		.from(s.story)
		.leftJoin(latest, eq(latest.storyId, s.story.id))
		.leftJoin(
			s.storyVersion,
			and(eq(s.storyVersion.storyId, s.story.id), eq(s.storyVersion.version, latest.maxVersion)),
		)
		.where(eq(s.story.chatId, chatId))
		.orderBy(asc(s.story.createdAt))
		.execute();
}

export type VersionProvenance = {
	origin: StoryVersionOrigin;
	authorId: string | null;
	sourceChatId: string | null;
};

const STORY_VERSION_UNIQUE_CONSTRAINT = 'story_version_story_version_unique';

export class StoryVersionConflictError extends Error {
	constructor(
		message = 'Someone saved a newer version while you were editing. Copy your changes, then cancel to see the latest version.',
	) {
		super(message);
		this.name = 'StoryVersionConflictError';
	}
}

/** True when an insert lost the race for a story version number to a concurrent save. */
export function isStoryVersionUniqueViolation(error: unknown): boolean {
	const databaseError = error instanceof Error && error.cause ? error.cause : error;
	if (!databaseError || typeof databaseError !== 'object') {
		return false;
	}
	const { code, constraint_name: constraintName, message } = databaseError as Record<string, unknown>;
	return (
		(code === '23505' && constraintName === STORY_VERSION_UNIQUE_CONSTRAINT) ||
		(typeof message === 'string' && message.includes('UNIQUE constraint failed: story_version'))
	);
}

export async function createStoryVersion(
	data: {
		chatId: string;
		slug: string;
		title: string;
		code: string;
		action: 'create' | 'update' | 'replace';
		source: 'assistant' | 'user';
		basedOnVersion?: number;
	} & VersionProvenance,
	executor: DBExecutor = db,
): Promise<DBStoryVersion & { title: string }> {
	const story = await getOrCreateStory({ chatId: data.chatId, slug: data.slug, title: data.title }, executor);

	const nextVersion = executor
		.select({ v: sql<number>`coalesce(max(${s.storyVersion.version}), 0) + 1` })
		.from(s.storyVersion)
		.where(eq(s.storyVersion.storyId, story.id));

	if (data.basedOnVersion !== undefined) {
		await assertBasedOnLatestVersion(story.id, data.basedOnVersion, executor);
	}
	try {
		const [created] = await executor
			.insert(s.storyVersion)
			.values({
				storyId: story.id,
				code: data.code,
				action: data.action,
				source: data.source,
				origin: data.origin,
				authorId: data.authorId,
				sourceChatId: data.sourceChatId,
				version: data.basedOnVersion === undefined ? sql`(${nextVersion})` : data.basedOnVersion + 1,
			})
			.returning()
			.execute();
		return { ...created, title: story.title };
	} catch (error) {
		if (data.basedOnVersion !== undefined && isStoryVersionUniqueViolation(error)) {
			throw new StoryVersionConflictError();
		}
		throw error;
	}
}

export async function createStandaloneVersion(data: {
	userId: string;
	projectId: string;
	slug: string;
	title: string;
	code: string;
	action: 'create' | 'update' | 'replace';
	source: 'assistant' | 'user';
	origin: StoryVersionOrigin;
	basedOnVersion?: number;
}): Promise<DBStoryVersion & { title: string }> {
	const story = await getOrCreateStandaloneStory({
		userId: data.userId,
		projectId: data.projectId,
		slug: data.slug,
		title: data.title,
	});

	const nextVersion = db
		.select({ v: sql<number>`coalesce(max(${s.storyVersion.version}), 0) + 1` })
		.from(s.storyVersion)
		.where(eq(s.storyVersion.storyId, story.id));

	if (data.basedOnVersion !== undefined) {
		await assertBasedOnLatestVersion(story.id, data.basedOnVersion, db);
	}
	try {
		const [created] = await db
			.insert(s.storyVersion)
			.values({
				storyId: story.id,
				code: data.code,
				action: data.action,
				source: data.source,
				origin: data.origin,
				authorId: data.userId,
				version: data.basedOnVersion === undefined ? sql`(${nextVersion})` : data.basedOnVersion + 1,
			})
			.returning()
			.execute();
		return { ...created, title: story.title };
	} catch (error) {
		if (data.basedOnVersion !== undefined && isStoryVersionUniqueViolation(error)) {
			throw new StoryVersionConflictError();
		}
		throw error;
	}
}

export async function createStandaloneStory(data: {
	userId: string;
	projectId: string;
	slug: string;
	title: string;
	code: string;
	source: 'assistant' | 'user';
	origin: StoryVersionOrigin;
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
				origin: data.origin,
				authorId: data.userId,
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

/** Gives a standalone story its chat, unless another chat claimed it first. */
export async function claimStandaloneStoryChat(storyId: string, chatId: string): Promise<boolean> {
	const claimed = await db
		.update(s.story)
		.set({ chatId })
		.where(and(eq(s.story.id, storyId), isNull(s.story.chatId)))
		.returning({ id: s.story.id })
		.execute();
	return claimed.length > 0;
}

export async function archiveStory(chatId: string, slug: string): Promise<void> {
	const matcher = and(eq(s.story.chatId, chatId), eq(s.story.slug, slug));
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

export async function setStoryCertification(storyId: string, certifiedBy: string | null): Promise<Date | null> {
	const certifiedAt = certifiedBy ? new Date() : null;
	await db.update(s.story).set({ certifiedAt, certifiedBy }).where(eq(s.story.id, storyId)).execute();
	return certifiedAt;
}

export async function getStoryCertification(
	storyId: string,
): Promise<{ certifiedAt: Date | null; certifiedByName: string | null }> {
	const [row] = await db
		.select({ certifiedAt: s.story.certifiedAt, certifiedByName: storyCertifier.name })
		.from(s.story)
		.leftJoin(storyCertifier, eq(s.story.certifiedBy, storyCertifier.id))
		.where(eq(s.story.id, storyId))
		.limit(1)
		.execute();
	return row ?? { certifiedAt: null, certifiedByName: null };
}

async function detachStoriesFromFolders(storyIds: string[]): Promise<void> {
	if (storyIds.length === 0) {
		return;
	}
	await db.delete(s.storyFolderItem).where(inArray(s.storyFolderItem.storyId, storyIds)).execute();
}

/** Matches `story` rows the user owns or that are shared with them within the project. */
export function storyVisibleToUser(userId: string, projectId: string, lockedGroupIds: readonly string[]): SQL {
	return sql`(
		exists (
			select 1 from ${s.chat}
			where ${s.chat.id} = ${s.story.chatId} and ${s.chat.userId} = ${userId}
		)
		or (${s.story.chatId} is null and ${s.story.userId} = ${userId})
		or exists (
			select 1 from ${s.sharedStory}
			where ${s.sharedStory.storyId} = ${s.story.id}
			  and ${s.sharedStory.projectId} = ${projectId}
			  and (
				${s.sharedStory.userId} = ${userId}
				or ${s.sharedStory.visibility} = 'project'
				or ${sharedStoryGrantsUser(userId, lockedGroupIds)}
			  )
		)
	)`;
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
	const openProjectIds = getOpenProjectIds();
	const isOpenProject = openProjectIds.length > 0 ? inArray(s.sharedStory.projectId, openProjectIds) : undefined;
	const lockedGroupIds = await listLockedUserGroupIdsOfMember(userId);

	const [shared] = await db
		.select({ id: s.sharedStory.id })
		.from(s.sharedStory)
		.innerJoin(s.project, eq(s.project.id, s.sharedStory.projectId))
		.where(
			and(
				eq(s.sharedStory.storyId, storyId),
				or(
					eq(s.sharedStory.userId, userId),
					and(eq(s.sharedStory.visibility, 'project'), or(isProjectMember, isOrgMember, isOpenProject)),
					and(eq(s.sharedStory.visibility, 'specific'), sharedStoryGrantsUser(userId, lockedGroupIds)),
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
		| 'format'
	>;

export function getLatestVersionByChatAndSlug(chatId: string, slug: string): Promise<StoryVersionWithStory | null> {
	return getStoryVersion(and(eq(s.story.chatId, chatId), eq(s.story.slug, slug))!, { latest: true });
}

export function getLatestVersionByStoryId(storyId: string): Promise<StoryVersionWithStory | null> {
	return getStoryVersion(eq(s.story.id, storyId), { latest: true });
}

export async function getLatestVersionStamp(
	storyId: string,
): Promise<{ version: number; authorName: string | null } | null> {
	const [row] = await db
		.select({ version: s.storyVersion.version, authorName: s.user.name })
		.from(s.storyVersion)
		.leftJoin(s.user, eq(s.user.id, s.storyVersion.authorId))
		.where(eq(s.storyVersion.storyId, storyId))
		.orderBy(desc(s.storyVersion.version))
		.limit(1)
		.execute();
	return row ?? null;
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

export function getVersionById(
	chatId: string,
	slug: string,
	storyVersionId: string,
): Promise<StoryVersionWithStory | null> {
	return getStoryVersion(
		and(eq(s.story.chatId, chatId), eq(s.story.slug, slug), eq(s.storyVersion.id, storyVersionId))!,
	);
}

export function getVersionByStoryIdAndNumber(
	storyId: string,
	versionNumber: number,
): Promise<StoryVersionWithStory | null> {
	return getStoryVersion(and(eq(s.story.id, storyId), eq(s.storyVersion.version, versionNumber))!);
}

export function listStoryVersions(chatId: string, slug: string): Promise<DBStoryVersion[]> {
	return listVersions(and(eq(s.story.chatId, chatId), eq(s.story.slug, slug))!);
}

export function listStoryVersionsByStoryId(storyId: string): Promise<DBStoryVersion[]> {
	return listVersions(eq(s.story.id, storyId));
}

export type StoryVersionChangeRow = Pick<DBStoryVersion, 'version' | 'origin' | 'source' | 'authorId'> & {
	authorName: string | null;
	sourceChat: {
		id: string;
		ownerId: string;
		title: string;
		isDeleted: boolean;
		isQuickQuestion: boolean;
	} | null;
};

/** Each version with its author and the chat it was made from, oldest first. */
export async function listStoryVersionChanges(storyId: string): Promise<StoryVersionChangeRow[]> {
	const rows = await db
		.select({
			version: s.storyVersion.version,
			origin: s.storyVersion.origin,
			source: s.storyVersion.source,
			authorId: s.storyVersion.authorId,
			authorName: s.user.name,
			sourceChatId: s.chat.id,
			sourceChatOwnerId: s.chat.userId,
			sourceChatTitle: s.chat.title,
			sourceChatDeletedAt: s.chat.deletedAt,
			sourceChatForkMetadata: s.chat.forkMetadata,
		})
		.from(s.storyVersion)
		.leftJoin(s.user, eq(s.user.id, s.storyVersion.authorId))
		.leftJoin(s.chat, eq(s.chat.id, s.storyVersion.sourceChatId))
		.where(eq(s.storyVersion.storyId, storyId))
		.orderBy(asc(s.storyVersion.version))
		.execute();

	return rows.map(({ sourceChatId, sourceChatOwnerId, sourceChatTitle, sourceChatDeletedAt, ...row }) => ({
		version: row.version,
		origin: row.origin,
		source: row.source,
		authorId: row.authorId,
		authorName: row.authorName,
		sourceChat:
			sourceChatId && sourceChatOwnerId
				? {
						id: sourceChatId,
						ownerId: sourceChatOwnerId,
						title: sourceChatTitle ?? '',
						isDeleted: sourceChatDeletedAt !== null,
						isQuickQuestion: isQuickQuestionForkType(row.sourceChatForkMetadata?.type),
					}
				: null,
	}));
}

/** Titles of the stories the user owns in the project, in a chat or standalone, that start with the prefix. */
export async function listOwnedStoryTitlesStartingWith(
	userId: string,
	projectId: string,
	prefix: string,
): Promise<string[]> {
	const rows = await db
		.select({ title: s.story.title })
		.from(s.story)
		.leftJoin(s.chat, eq(s.story.chatId, s.chat.id))
		.where(
			and(
				or(
					and(eq(s.chat.userId, userId), eq(s.chat.projectId, projectId)),
					and(isNull(s.story.chatId), eq(s.story.userId, userId), eq(s.story.projectId, projectId)),
				),
				sql`substr(${s.story.title}, 1, ${[...prefix].length}) = ${prefix}`,
			),
		)
		.execute();
	return rows.map((row) => row.title);
}

export async function listStandaloneSlugsStartingWith(
	userId: string,
	projectId: string,
	prefix: string,
): Promise<string[]> {
	const rows = await db
		.select({ slug: s.story.slug })
		.from(s.story)
		.where(
			and(
				eq(s.story.projectId, projectId),
				eq(s.story.userId, userId),
				isNull(s.story.chatId),
				sql`substr(${s.story.slug}, 1, ${prefix.length}) = ${prefix}`,
			),
		)
		.execute();
	return rows.map((row) => row.slug);
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

export async function getStoryDataCachedAt(storyId: string): Promise<Date | null> {
	const [row] = await db
		.select({ cachedAt: s.storyDataCache.cachedAt })
		.from(s.storyDataCache)
		.where(eq(s.storyDataCache.storyId, storyId))
		.execute();
	return row?.cachedAt ?? null;
}

export async function getStoryQueryDataByStoryIds(
	storyIds: string[],
): Promise<Map<string, DBStoryDataCache['queryData']>> {
	if (storyIds.length === 0) {
		return new Map();
	}
	const rows = await db
		.select({ storyId: s.storyDataCache.storyId, queryData: s.storyDataCache.queryData })
		.from(s.storyDataCache)
		.where(inArray(s.storyDataCache.storyId, storyIds))
		.execute();
	return new Map(rows.map((row) => [row.storyId, row.queryData]));
}

export async function upsertStoryDataCache(
	chatId: string,
	slug: string,
	queryData: Record<string, { data: unknown[]; columns: string[] }>,
	querySources: StoryQuerySources,
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
			querySources,
			analysisResults: analysisResults ?? null,
			cachedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: s.storyDataCache.storyId,
			set: {
				queryData,
				querySources,
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
	analysisResults?: Record<string, string> | null,
): Promise<void> {
	const narratives = analysisResults === undefined ? {} : { analysisResults };
	await db
		.insert(s.storyDataCache)
		.values({ storyId, queryData, querySources: null, cachedAt: new Date(), ...narratives })
		.onConflictDoUpdate({
			target: s.storyDataCache.storyId,
			set: { queryData, querySources: null, cachedAt: new Date(), ...narratives },
		})
		.execute();
}

/** Frozen narratives are saved with a snapshot (no query sources), unlike the ones a live refresh generates. */
export async function keepOnlyFrozenStoryNarratives(storyId: string, narrativeIds: string[]): Promise<void> {
	for (let attempt = 0; attempt < MAX_NARRATIVE_WRITE_ATTEMPTS; attempt++) {
		const isSettled = await tryKeepOnlyFrozenStoryNarratives(storyId, narrativeIds);
		if (isSettled) {
			return;
		}
	}
}

const MAX_NARRATIVE_WRITE_ATTEMPTS = 3;

async function tryKeepOnlyFrozenStoryNarratives(storyId: string, narrativeIds: string[]): Promise<boolean> {
	const frozenCache = and(eq(s.storyDataCache.storyId, storyId), isNull(s.storyDataCache.querySources));
	const [cache] = await db.select().from(s.storyDataCache).where(frozenCache).execute();
	if (!cache?.analysisResults) {
		return true;
	}
	const kept = Object.fromEntries(Object.entries(cache.analysisResults).filter(([id]) => narrativeIds.includes(id)));
	const updated = await db
		.update(s.storyDataCache)
		.set({ analysisResults: Object.keys(kept).length > 0 ? kept : null })
		.where(and(frozenCache, eq(s.storyDataCache.analysisResults, cache.analysisResults)))
		.returning({ storyId: s.storyDataCache.storyId })
		.execute();
	return updated.length > 0;
}

export async function getSqlQueriesFromCode(
	chatId: string,
	code: string,
): Promise<Record<string, executeSqlQueries.StoredSqlQuery>> {
	const queryIds = extractQueryIds(code);
	if (queryIds.size === 0) {
		return {};
	}

	return executeSqlQueries.getLatestSqlQueriesByIds(chatId, queryIds);
}

export async function getSqlQueriesByIds(
	chatId: string,
	queryIds: Set<string>,
): Promise<Record<string, executeSqlQueries.StoredSqlQuery>> {
	return executeSqlQueries.getLatestSqlQueriesByIds(chatId, queryIds);
}

export async function getSqlQueryById(
	chatId: string,
	queryId: string,
): Promise<executeSqlQueries.StoredSqlQuery | null> {
	const part = await executeSqlQueries.getExecuteSqlPartByQueryIdInChat(chatId, queryId);
	if (!part) {
		return null;
	}
	return {
		sqlQuery: part.toolInput.sql_query,
		...(part.toolInput.database_id && { databaseId: part.toolInput.database_id }),
		adminMode: part.adminMode,
		...(part.semanticQuery && { semanticQuery: part.semanticQuery }),
	};
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
			projectId: sql<string>`coalesce(${s.story.projectId}, ${s.chat.projectId})`,
			userId: s.story.userId,
			slug: s.story.slug,
			title: s.story.title,
			isLive: s.story.isLive,
			isLiveTextDynamic: s.story.isLiveTextDynamic,
			cacheSchedule: s.story.cacheSchedule,
			cacheScheduleDescription: s.story.cacheScheduleDescription,
			archivedAt: s.story.archivedAt,
			certifiedAt: s.story.certifiedAt,
			certifiedByName: storyCertifier.name,
			format: s.story.format,
			createdAt: s.story.createdAt,
			updatedAt: s.story.updatedAt,
			code: s.storyVersion.code,
			version: s.storyVersion.version,
			versionCreatedAt: s.storyVersion.createdAt,
		})
		.from(s.story)
		.leftJoin(s.chat, eq(s.story.chatId, s.chat.id))
		.leftJoin(storyCertifier, eq(s.story.certifiedBy, storyCertifier.id))
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

async function assertBasedOnLatestVersion(
	storyId: string,
	basedOnVersion: number,
	executor: DBExecutor,
): Promise<void> {
	const [latest] = await executor
		.select({ version: s.storyVersion.version })
		.from(s.storyVersion)
		.where(eq(s.storyVersion.storyId, storyId))
		.orderBy(desc(s.storyVersion.version))
		.limit(1)
		.execute();
	if ((latest?.version ?? 0) !== basedOnVersion) {
		throw new StoryVersionConflictError();
	}
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
			origin: s.storyVersion.origin,
			authorId: s.storyVersion.authorId,
			sourceChatId: s.storyVersion.sourceChatId,
			createdAt: s.storyVersion.createdAt,
			title: s.story.title,
			slug: s.story.slug,
			chatId: s.story.chatId,
			isLive: s.story.isLive,
			isLiveTextDynamic: s.story.isLiveTextDynamic,
			cacheSchedule: s.story.cacheSchedule,
			cacheScheduleDescription: s.story.cacheScheduleDescription,
			archivedAt: s.story.archivedAt,
			format: s.story.format,
		})
		.from(s.storyVersion)
		.innerJoin(s.story, eq(s.storyVersion.storyId, s.story.id))
		.where(whereCondition);

	const ordered = options?.latest ? query.orderBy(desc(s.storyVersion.version)) : query;
	const [row] = await ordered.limit(1).execute();

	return row ?? null;
}

function listVersions(whereCondition: SQL): Promise<DBStoryVersion[]> {
	return db
		.select({
			id: s.storyVersion.id,
			storyId: s.storyVersion.storyId,
			version: s.storyVersion.version,
			code: s.storyVersion.code,
			action: s.storyVersion.action,
			source: s.storyVersion.source,
			origin: s.storyVersion.origin,
			authorId: s.storyVersion.authorId,
			sourceChatId: s.storyVersion.sourceChatId,
			createdAt: s.storyVersion.createdAt,
		})
		.from(s.storyVersion)
		.innerJoin(s.story, eq(s.storyVersion.storyId, s.story.id))
		.where(whereCondition)
		.orderBy(asc(s.storyVersion.version))
		.execute();
}

async function getStoryDataCache(whereCondition: SQL): Promise<DBStoryDataCache | null> {
	const [row] = await db
		.select({
			storyId: s.storyDataCache.storyId,
			queryData: s.storyDataCache.queryData,
			querySources: s.storyDataCache.querySources,
			analysisResults: s.storyDataCache.analysisResults,
			cachedAt: s.storyDataCache.cachedAt,
		})
		.from(s.storyDataCache)
		.innerJoin(s.story, eq(s.storyDataCache.storyId, s.story.id))
		.where(whereCondition)
		.execute();

	return row ?? null;
}

export async function getStoryViewerDataCache(
	chatId: string,
	slug: string,
	storyVersionId: string,
	userId: string,
	permissionRevision: string,
): Promise<DBStoryViewerDataCache | null> {
	const [row] = await db
		.select({
			storyId: s.storyViewerDataCache.storyId,
			storyVersionId: s.storyViewerDataCache.storyVersionId,
			userId: s.storyViewerDataCache.userId,
			permissionRevision: s.storyViewerDataCache.permissionRevision,
			queryData: s.storyViewerDataCache.queryData,
			code: s.storyViewerDataCache.code,
			querySources: s.storyViewerDataCache.querySources,
			analysisResults: s.storyViewerDataCache.analysisResults,
			cachedAt: s.storyViewerDataCache.cachedAt,
		})
		.from(s.storyViewerDataCache)
		.innerJoin(s.story, eq(s.storyViewerDataCache.storyId, s.story.id))
		.where(
			and(
				eq(s.story.chatId, chatId),
				eq(s.story.slug, slug),
				eq(s.storyViewerDataCache.storyVersionId, storyVersionId),
				eq(s.storyViewerDataCache.userId, userId),
				eq(s.storyViewerDataCache.permissionRevision, permissionRevision),
			),
		)
		.execute();
	return row ?? null;
}

export async function upsertStoryViewerDataCache(
	storyId: string,
	storyVersionId: string,
	userId: string,
	projectId: string,
	viewerCacheRevision: number,
	permissionRevision: string,
	queryData: Record<string, { data: unknown[]; columns: string[] }>,
	querySources: StoryQuerySources,
	analysisResults?: Record<string, string> | null,
	code?: string | null,
): Promise<boolean> {
	const values = {
		permissionRevision,
		queryData,
		code: code ?? null,
		querySources,
		analysisResults: analysisResults ?? null,
		cachedAt: new Date(),
	};
	if (dbConfig.dialect === Dialect.Sqlite) {
		return db.transaction((transaction) => {
			const [project] = transaction
				.update(s.project)
				.set({
					viewerCacheRevision: sql`${s.project.viewerCacheRevision}`,
					updatedAt: sql`${s.project.updatedAt}`,
				})
				.where(and(eq(s.project.id, projectId), eq(s.project.viewerCacheRevision, viewerCacheRevision)))
				.returning({ id: s.project.id })
				.all();
			if (!project) {
				return false;
			}
			transaction
				.insert(s.storyViewerDataCache)
				.values({ storyId, storyVersionId, userId, ...values })
				.onConflictDoUpdate({
					target: [s.storyViewerDataCache.storyVersionId, s.storyViewerDataCache.userId],
					set: values,
				})
				.run();
			return true;
		});
	}
	return db.transaction(async (transaction) => {
		const [project] = await transaction
			.update(s.project)
			.set({
				viewerCacheRevision: sql`${s.project.viewerCacheRevision}`,
				updatedAt: sql`${s.project.updatedAt}`,
			})
			.where(and(eq(s.project.id, projectId), eq(s.project.viewerCacheRevision, viewerCacheRevision)))
			.returning({ id: s.project.id })
			.execute();
		if (!project) {
			return false;
		}
		await transaction
			.insert(s.storyViewerDataCache)
			.values({ storyId, storyVersionId, userId, ...values })
			.onConflictDoUpdate({
				target: [s.storyViewerDataCache.storyVersionId, s.storyViewerDataCache.userId],
				set: values,
			})
			.execute();
		return true;
	});
}

export async function deleteStoryViewerDataCache(storyId: string): Promise<void> {
	await db.delete(s.storyViewerDataCache).where(eq(s.storyViewerDataCache.storyId, storyId)).execute();
}

export async function invalidateProjectViewerCaches(projectId: string, executor?: DBExecutor): Promise<void> {
	if (!executor) {
		if (dbConfig.dialect === Dialect.Sqlite) {
			db.transaction((transaction) => invalidateProjectViewerCachesSqlite(projectId, transaction));
			return;
		}
		await db.transaction((transaction) => invalidateProjectViewerCaches(projectId, transaction));
		return;
	}
	await bumpProjectViewerCacheRevision(projectId, executor);
	const storyIds = await getProjectStoryIds(projectId, executor);
	if (storyIds.length === 0) {
		return;
	}
	await executor.delete(s.storyViewerDataCache).where(inArray(s.storyViewerDataCache.storyId, storyIds)).execute();
}

export async function invalidateUserViewerCaches(
	projectId: string,
	userId: string,
	executor?: DBExecutor,
): Promise<void> {
	if (!executor) {
		if (dbConfig.dialect === Dialect.Sqlite) {
			db.transaction((transaction) => invalidateUserViewerCachesSqlite(projectId, userId, transaction));
			return;
		}
		await db.transaction((transaction) => invalidateUserViewerCaches(projectId, userId, transaction));
		return;
	}
	await bumpProjectViewerCacheRevision(projectId, executor);
	const storyIds = await getProjectStoryIds(projectId, executor);
	if (storyIds.length === 0) {
		return;
	}
	await executor
		.delete(s.storyViewerDataCache)
		.where(and(inArray(s.storyViewerDataCache.storyId, storyIds), eq(s.storyViewerDataCache.userId, userId)))
		.execute();
}

function invalidateProjectViewerCachesSqlite(projectId: string, executor: DBExecutor): void {
	bumpProjectViewerCacheRevisionSqlite(projectId, executor);
	const storyIds = getProjectStoryIdsSqlite(projectId, executor);
	if (storyIds.length > 0) {
		executor.delete(s.storyViewerDataCache).where(inArray(s.storyViewerDataCache.storyId, storyIds)).run();
	}
}

function invalidateUserViewerCachesSqlite(projectId: string, userId: string, executor: DBExecutor): void {
	bumpProjectViewerCacheRevisionSqlite(projectId, executor);
	const storyIds = getProjectStoryIdsSqlite(projectId, executor);
	if (storyIds.length > 0) {
		executor
			.delete(s.storyViewerDataCache)
			.where(and(inArray(s.storyViewerDataCache.storyId, storyIds), eq(s.storyViewerDataCache.userId, userId)))
			.run();
	}
}

function bumpProjectViewerCacheRevisionSqlite(projectId: string, executor: DBExecutor): void {
	executor
		.update(s.project)
		.set({
			viewerCacheRevision: sql`${s.project.viewerCacheRevision} + 1`,
			updatedAt: sql`${s.project.updatedAt}`,
		})
		.where(eq(s.project.id, projectId))
		.run();
}

async function bumpProjectViewerCacheRevision(projectId: string, executor: DBExecutor): Promise<void> {
	await executor
		.update(s.project)
		.set({
			viewerCacheRevision: sql`${s.project.viewerCacheRevision} + 1`,
			updatedAt: sql`${s.project.updatedAt}`,
		})
		.where(eq(s.project.id, projectId))
		.execute();
}

function getProjectStoryIdsSqlite(projectId: string, executor: DBExecutor): string[] {
	return executor
		.select({ id: s.story.id })
		.from(s.story)
		.leftJoin(s.chat, eq(s.story.chatId, s.chat.id))
		.where(or(eq(s.story.projectId, projectId), eq(s.chat.projectId, projectId)))
		.all()
		.map(({ id }) => id);
}

async function getProjectStoryIds(projectId: string, executor: DBExecutor): Promise<string[]> {
	const stories = await executor
		.select({ id: s.story.id })
		.from(s.story)
		.leftJoin(s.chat, eq(s.story.chatId, s.chat.id))
		.where(or(eq(s.story.projectId, projectId), eq(s.chat.projectId, projectId)))
		.execute();

	return stories.map(({ id }) => id);
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
			sharedWithCount: countDistinct(s.sharedStoryAccess.userId),
			sharedWithGroupCount: countDistinct(s.sharedStoryGroupAccess.groupId),
		})
		.from(s.sharedStory)
		.leftJoin(s.sharedStoryAccess, eq(s.sharedStoryAccess.sharedStoryId, s.sharedStory.id))
		.leftJoin(s.sharedStoryGroupAccess, eq(s.sharedStoryGroupAccess.sharedStoryId, s.sharedStory.id))
		.where(inArray(s.sharedStory.storyId, storyIds))
		.groupBy(s.sharedStory.id)
		.execute();

	const result = new Map<string, StorySharingInfo>();
	for (const row of rows) {
		result.set(row.storyId, {
			visibility: row.visibility,
			sharedWithCount: row.sharedWithCount,
			sharedWithGroupCount: row.sharedWithGroupCount,
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
