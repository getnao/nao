import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import s, { type DBAiUsage } from '../db/abstractSchema';
import { db } from '../db/db';
import type { CreditCursor } from './credit-wallet.queries';

export async function listAiUsage(
	scope: { orgId: string; userId?: string },
	input: { cursor?: CreditCursor; limit: number },
): Promise<{ runs: AiUsageRun[]; nextCursor: CreditCursor | null }> {
	const runId = s.aiUsage.runId;
	const latestStartedAt = sql<Date>`max(${s.aiUsage.startedAt})`.mapWith(s.aiUsage.startedAt);
	const cursorStartedAt = input.cursor && sql.param(input.cursor.createdAt, s.aiUsage.startedAt);
	const scopeFilter = and(
		eq(s.aiUsage.orgId, scope.orgId),
		scope.userId ? eq(s.aiUsage.userId, scope.userId) : undefined,
	);
	const runRows = await db
		.select({ id: runId, startedAt: latestStartedAt })
		.from(s.aiUsage)
		.where(scopeFilter)
		.groupBy(runId)
		.having(
			input.cursor
				? sql`(${latestStartedAt} < ${cursorStartedAt} or (${latestStartedAt} = ${cursorStartedAt} and ${runId} < ${input.cursor.id}))`
				: undefined,
		)
		.orderBy(desc(latestStartedAt), desc(runId))
		.limit(input.limit + 1);
	const hasNext = runRows.length > input.limit;
	const page = runRows.slice(0, input.limit);
	const events =
		page.length === 0
			? []
			: await db
					.select({ event: s.aiUsage, chatTitle: s.chat.title })
					.from(s.aiUsage)
					.leftJoin(s.chat, eq(s.aiUsage.chatId, s.chat.id))
					.where(
						and(
							scopeFilter,
							inArray(
								runId,
								page.map((run) => run.id),
							),
						),
					)
					.orderBy(s.aiUsage.startedAt, s.aiUsage.id);
	const eventsByRun = new Map<string, DBAiUsage[]>();
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
		return runEvents
			? [
					{
						id: run.id,
						startedAt: run.startedAt,
						chatTitle: chatTitlesByRun.get(run.id) ?? null,
						events: runEvents,
					},
				]
			: [];
	});
	const last = runs.at(-1);
	return {
		runs,
		nextCursor: hasNext && last ? { createdAt: last.startedAt, id: last.id } : null,
	};
}

export interface AiUsageRun {
	id: string;
	startedAt: Date;
	chatTitle: string | null;
	events: DBAiUsage[];
}
