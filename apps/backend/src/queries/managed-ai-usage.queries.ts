import { and, countDistinct, desc, eq, inArray, sql } from 'drizzle-orm';

import s, { type DBManagedAiUsage } from '../db/abstractSchema';
import { db } from '../db/db';
import * as userQueries from './user.queries';

export async function listManagedAiUsage(
	scope: { orgId: string; userId?: string },
	input: { cursor?: ManagedAiUsageCursor; limit: number },
): Promise<{ runs: ManagedAiUsageRun[]; nextCursor: ManagedAiUsageCursor | null; totalCount: number }> {
	const runId = s.managedAiUsage.runId;
	const latestStartedAt = sql<Date>`max(${s.managedAiUsage.startedAt})`.mapWith(s.managedAiUsage.startedAt);
	const cursorStartedAt = input.cursor && sql.param(input.cursor.startedAt, s.managedAiUsage.startedAt);
	const scopeFilter = and(
		eq(s.managedAiUsage.isManaged, true),
		eq(s.managedAiUsage.orgId, scope.orgId),
		scope.userId ? eq(s.managedAiUsage.userId, scope.userId) : undefined,
	);
	const [runRows, [countRow]] = await Promise.all([
		db
			.select({ id: runId, startedAt: latestStartedAt })
			.from(s.managedAiUsage)
			.where(scopeFilter)
			.groupBy(runId)
			.having(
				input.cursor
					? sql`(${latestStartedAt} < ${cursorStartedAt} or (${latestStartedAt} = ${cursorStartedAt} and ${runId} < ${input.cursor.id}))`
					: undefined,
			)
			.orderBy(desc(latestStartedAt), desc(runId))
			.limit(input.limit + 1),
		db
			.select({ totalCount: countDistinct(runId) })
			.from(s.managedAiUsage)
			.where(scopeFilter),
	]);
	const hasNext = runRows.length > input.limit;
	const page = runRows.slice(0, input.limit);
	const events =
		page.length === 0
			? []
			: await db
					.select({ event: s.managedAiUsage, chatTitle: s.chat.title })
					.from(s.managedAiUsage)
					.leftJoin(s.chat, eq(s.managedAiUsage.chatId, s.chat.id))
					.where(
						and(
							scopeFilter,
							inArray(
								runId,
								page.map((run) => run.id),
							),
						),
					)
					.orderBy(s.managedAiUsage.startedAt, s.managedAiUsage.id);
	const userIds = events.map(({ event }) => event.userId).filter((userId): userId is string => userId !== null);
	const userNames = await userQueries.getUserNames([...new Set(userIds)]);
	const eventsByRun = new Map<string, DBManagedAiUsage[]>();
	const chatTitlesByRun = new Map<string, string>();
	for (const { event, chatTitle } of events) {
		const runEvents = eventsByRun.get(event.runId);
		if (runEvents) {
			runEvents.push(event);
		} else {
			eventsByRun.set(event.runId, [event]);
		}
		if (chatTitle) {
			chatTitlesByRun.set(event.runId, chatTitle);
		}
	}
	const runs = page.flatMap((run) => {
		const runEvents = eventsByRun.get(run.id);
		const userId = runEvents?.find((event) => event.userId)?.userId;
		return runEvents
			? [
					{
						id: run.id,
						startedAt: run.startedAt,
						chatTitle: chatTitlesByRun.get(run.id) ?? null,
						userName: userId ? (userNames.get(userId) ?? null) : null,
						events: runEvents,
					},
				]
			: [];
	});
	const last = runs.at(-1);
	return {
		runs,
		nextCursor: hasNext && last ? { startedAt: last.startedAt, id: last.id } : null,
		totalCount: countRow?.totalCount ?? 0,
	};
}

export type ManagedAiUsageCursor = { startedAt: Date; id: string };

export interface ManagedAiUsageRun {
	id: string;
	startedAt: Date;
	chatTitle: string | null;
	userName: string | null;
	events: DBManagedAiUsage[];
}
