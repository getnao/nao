import type { AnalyticsAssetType, AnalyticsEventType } from '@nao/shared/types';
import { and, count, desc, eq, isNotNull, or, sql } from 'drizzle-orm';

import type { DBAnalyticsEvent, NewAnalyticsEvent } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';

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

	const cutoff = new Date(Date.now() - THROTTLE_MS);
	const cutoffFilter =
		dbConfig.dialect === Dialect.Postgres
			? sql`${s.analyticsEvent.createdAt} >= ${cutoff.toISOString()}`
			: sql`${s.analyticsEvent.createdAt} >= ${cutoff.getTime()}`;

	const [row] = await db
		.select()
		.from(s.analyticsEvent)
		.where(and(...filters, cutoffFilter))
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

export const countStoryViewsByProject = async (projectId: string): Promise<Record<string, number>> => {
	const rows = await db
		.select({ storyId: s.analyticsEvent.storyId, views: count() })
		.from(s.analyticsEvent)
		.where(
			and(
				eq(s.analyticsEvent.projectId, projectId),
				eq(s.analyticsEvent.type, 'page_view'),
				eq(s.analyticsEvent.assetType, 'story'),
				isNotNull(s.analyticsEvent.storyId),
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
