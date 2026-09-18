import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import type { FrecencyVisit } from '../services/frecency';

export interface ChatCandidateRow {
	id: string;
	title: string;
	ownerId: string;
	ownerName: string;
	createdAt: Date;
	isAutomationRun: boolean;
}

export interface StoryCandidateRow {
	id: string;
	title: string;
	ownerId: string | null;
	ownerName: string | null;
	createdAt: Date;
}

export const listUserPageViews = async (input: {
	userId: string;
	projectId: string;
	since: Date;
	limit: number;
}): Promise<FrecencyVisit[]> => {
	const sinceFilter =
		dbConfig.dialect === Dialect.Postgres
			? sql`${s.analyticsEvent.createdAt} >= ${input.since.toISOString()}`
			: sql`${s.analyticsEvent.createdAt} >= ${input.since.getTime()}`;

	const rows = await db
		.select({
			assetType: s.analyticsEvent.assetType,
			chatId: s.analyticsEvent.chatId,
			storyId: s.analyticsEvent.storyId,
			sharedChatId: s.analyticsEvent.sharedChatId,
			sharedStoryId: s.analyticsEvent.sharedStoryId,
			createdAt: s.analyticsEvent.createdAt,
		})
		.from(s.analyticsEvent)
		.where(
			and(
				eq(s.analyticsEvent.type, 'page_view'),
				eq(s.analyticsEvent.actorUserId, input.userId),
				eq(s.analyticsEvent.projectId, input.projectId),
				sinceFilter,
			),
		)
		.orderBy(desc(s.analyticsEvent.createdAt))
		.limit(input.limit)
		.execute();

	const visits: FrecencyVisit[] = [];
	for (const row of rows) {
		const assetId = row.assetType === 'chat' ? row.chatId : row.storyId;
		if (!assetId) {
			continue;
		}
		visits.push({
			assetType: row.assetType,
			assetId,
			shareId: row.assetType === 'chat' ? row.sharedChatId : row.sharedStoryId,
			viewedAt: new Date(row.createdAt),
		});
	}
	return visits;
};

export const getChatCandidates = async (chatIds: string[]): Promise<ChatCandidateRow[]> => {
	if (chatIds.length === 0) {
		return [];
	}
	const rows = await db
		.select({
			id: s.chat.id,
			title: s.chat.title,
			ownerId: s.chat.userId,
			ownerName: s.user.name,
			createdAt: s.chat.createdAt,
			isAutomationRun: sql<number>`exists (select 1 from ${s.automationRun} where ${s.automationRun.chatId} = ${s.chat.id})`,
		})
		.from(s.chat)
		.innerJoin(s.user, eq(s.user.id, s.chat.userId))
		.where(and(inArray(s.chat.id, chatIds), isNull(s.chat.deletedAt)))
		.execute();

	return rows.map((row) => ({
		...row,
		createdAt: new Date(row.createdAt),
		isAutomationRun: Boolean(Number(row.isAutomationRun)),
	}));
};

export const getStoryCandidates = async (storyIds: string[]): Promise<StoryCandidateRow[]> => {
	if (storyIds.length === 0) {
		return [];
	}
	const rows = await db
		.select({
			id: s.story.id,
			title: s.story.title,
			ownerId: sql<string | null>`coalesce(${s.chat.userId}, ${s.story.userId})`,
			ownerName: s.user.name,
			createdAt: s.story.createdAt,
		})
		.from(s.story)
		.leftJoin(s.chat, eq(s.chat.id, s.story.chatId))
		.leftJoin(s.user, eq(s.user.id, sql`coalesce(${s.chat.userId}, ${s.story.userId})`))
		.where(and(inArray(s.story.id, storyIds), isNull(s.story.archivedAt)))
		.execute();

	return rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt) }));
};
