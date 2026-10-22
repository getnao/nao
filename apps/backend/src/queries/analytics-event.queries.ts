import type { AnalyticsAssetType, AnalyticsEventType } from '@nao/shared/types';
import { and, count, countDistinct, desc, eq, isNotNull, max, or, sql } from 'drizzle-orm';

import type { DBAnalyticsEvent, NewAnalyticsEvent } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import { storyVisibleToUser } from './story.queries';

const THROTTLE_MS = 2 * 60 * 1_000;

export const createEvent = async (input: NewAnalyticsEvent): Promise<DBAnalyticsEvent> => {
	const [created] = await db.insert(s.analyticsEvent).values(input).returning().execute();
	return created;
};

export const getLastEvent = async (input: {
	type: AnalyticsEventType;
	assetType: AnalyticsAssetType;
	actorUserId: string | null;
	chatId?: string | null;
	storyId?: string | null;
}): Promise<DBAnalyticsEvent | null> => {
	const filters = [eq(s.analyticsEvent.type, input.type), eq(s.analyticsEvent.assetType, input.assetType)];

	if (input.actorUserId) {
		filters.push(eq(s.analyticsEvent.actorUserId, input.actorUserId));
	} else {
		filters.push(sql`${s.analyticsEvent.actorUserId} IS NULL`);
	}

	if (input.chatId) {
		filters.push(eq(s.analyticsEvent.chatId, input.chatId));
	}
	if (input.storyId) {
		filters.push(eq(s.analyticsEvent.storyId, input.storyId));
	}

	const [row] = await db
		.select()
		.from(s.analyticsEvent)
		.where(and(...filters, createdSince(new Date(Date.now() - THROTTLE_MS))))
		.orderBy(desc(s.analyticsEvent.createdAt))
		.limit(1)
		.execute();

	return row ?? null;
};

export interface AssetEventRow {
	event: DBAnalyticsEvent;
	actorName: string | null;
}

export const listEventsForAsset = async (input: {
	assetType: AnalyticsAssetType;
	chatId?: string | null;
	storyId?: string | null;
	limit: number;
}): Promise<AssetEventRow[]> => {
	const filters = [];

	if (input.assetType === 'story' && input.storyId) {
		filters.push(eq(s.analyticsEvent.assetType, 'story'), eq(s.analyticsEvent.storyId, input.storyId));
	} else if (input.assetType === 'chat' && input.chatId) {
		filters.push(
			eq(s.analyticsEvent.chatId, input.chatId),
			or(eq(s.analyticsEvent.assetType, 'chat'), eq(s.analyticsEvent.type, 'download'))!,
		);
	} else {
		return [];
	}

	const rows = await db
		.select({ event: s.analyticsEvent, actorName: s.user.name })
		.from(s.analyticsEvent)
		.leftJoin(s.user, eq(s.user.id, s.analyticsEvent.actorUserId))
		.where(and(...filters))
		.orderBy(desc(s.analyticsEvent.createdAt))
		.limit(input.limit)
		.execute();

	return rows.map((r) => ({ event: r.event, actorName: r.actorName }));
};

export const countStoryViewsForUser = async (projectId: string, userId: string): Promise<Record<string, number>> => {
	const rows = await db
		.select({ storyId: s.analyticsEvent.storyId, views: count() })
		.from(s.analyticsEvent)
		.innerJoin(s.story, eq(s.story.id, s.analyticsEvent.storyId))
		.where(
			and(
				eq(s.analyticsEvent.projectId, projectId),
				eq(s.analyticsEvent.type, 'page_view'),
				eq(s.analyticsEvent.assetType, 'story'),
				storyVisibleToUser(userId, projectId),
			),
		)
		.groupBy(s.analyticsEvent.storyId)
		.execute();

	const viewsByStoryId: Record<string, number> = {};
	for (const row of rows) {
		if (row.storyId) {
			viewsByStoryId[row.storyId] = Number(row.views);
		}
	}
	return viewsByStoryId;
};

/** Story ids of the project ranked by how many people viewed them since the given date. */
export const listMostViewedStoryIds = async (projectId: string, since: Date, limit: number): Promise<string[]> => {
	const rows = await db
		.select({ storyId: s.analyticsEvent.storyId })
		.from(s.analyticsEvent)
		.where(
			and(
				eq(s.analyticsEvent.projectId, projectId),
				eq(s.analyticsEvent.type, 'page_view'),
				eq(s.analyticsEvent.assetType, 'story'),
				isNotNull(s.analyticsEvent.storyId),
				isNotNull(s.analyticsEvent.actorUserId),
				createdSince(since),
			),
		)
		.groupBy(s.analyticsEvent.storyId)
		.orderBy(desc(countDistinct(s.analyticsEvent.actorUserId)), desc(max(s.analyticsEvent.createdAt)))
		.limit(limit)
		.execute();

	return rows.flatMap((row) => (row.storyId ? [row.storyId] : []));
};

function createdSince(date: Date) {
	return dbConfig.dialect === Dialect.Postgres
		? sql`${s.analyticsEvent.createdAt} >= ${date.toISOString()}`
		: sql`${s.analyticsEvent.createdAt} >= ${date.getTime()}`;
}
