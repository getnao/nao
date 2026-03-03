import { and, asc, desc, eq, max, sql } from 'drizzle-orm';

import s, { type DBStoryVersion } from '../db/abstractSchema';
import { db } from '../db/db';

export async function createVersion(data: {
	chatId: string;
	storyId: string;
	title: string;
	code: string;
	action: 'create' | 'update' | 'replace';
	source: 'assistant' | 'user';
}): Promise<DBStoryVersion> {
	const nextVersion = db
		.select({ v: sql<number>`coalesce(max(${s.storyVersion.version}), 0) + 1` })
		.from(s.storyVersion)
		.where(and(eq(s.storyVersion.chatId, data.chatId), eq(s.storyVersion.storyId, data.storyId)));

	const [created] = await db
		.insert(s.storyVersion)
		.values({ ...data, version: sql`(${nextVersion})` })
		.returning()
		.execute();

	return created;
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
		.orderBy(desc(s.storyVersion.createdAt))
		.execute();
}
