import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

export type CreditCursor = { createdAt: Date; id: string };

export async function getCreditSummary(orgId: string): Promise<{
	balanceMicroUsd: number;
	lifetimeGrantedMicroUsd: number;
	lifetimeSpentMicroUsd: number;
}> {
	const [wallet] = await db.select().from(s.creditWallet).where(eq(s.creditWallet.orgId, orgId)).limit(1);
	if (!wallet) {
		return { balanceMicroUsd: 0, lifetimeGrantedMicroUsd: 0, lifetimeSpentMicroUsd: 0 };
	}
	const [totals] = await db
		.select({
			granted: sql<number>`coalesce(sum(case when ${s.creditLedger.deltaMicroUsd} > 0 then ${s.creditLedger.deltaMicroUsd} else 0 end), 0)`,
			spent: sql<number>`coalesce(sum(case when ${s.creditLedger.deltaMicroUsd} < 0 then -${s.creditLedger.deltaMicroUsd} else 0 end), 0)`,
		})
		.from(s.creditLedger)
		.where(eq(s.creditLedger.walletId, wallet.id));
	return {
		balanceMicroUsd: wallet.balanceMicroUsd,
		lifetimeGrantedMicroUsd: Number(totals?.granted ?? 0),
		lifetimeSpentMicroUsd: Number(totals?.spent ?? 0),
	};
}

export async function listCreditLedger(
	orgId: string,
	input: { cursor?: CreditCursor; limit: number },
): Promise<{ groups: CreditLedgerGroup[]; nextCursor: CreditCursor | null }> {
	const groupId = sql<string>`coalesce(${s.aiUsage.runId}, ${s.creditLedger.id})`;
	const latestCreatedAt = sql<Date>`max(${s.creditLedger.createdAt})`.mapWith(s.creditLedger.createdAt);
	const cursorCreatedAt = input.cursor && sql.param(input.cursor.createdAt, s.creditLedger.createdAt);
	const groupRows = await db
		.select({ id: groupId, createdAt: latestCreatedAt })
		.from(s.creditLedger)
		.innerJoin(s.creditWallet, eq(s.creditLedger.walletId, s.creditWallet.id))
		.leftJoin(s.aiUsage, eq(s.creditLedger.usageId, s.aiUsage.id))
		.where(eq(s.creditWallet.orgId, orgId))
		.groupBy(groupId)
		.having(
			input.cursor
				? sql`(${latestCreatedAt} < ${cursorCreatedAt} or (${latestCreatedAt} = ${cursorCreatedAt} and ${groupId} < ${input.cursor.id}))`
				: undefined,
		)
		.orderBy(desc(latestCreatedAt), desc(groupId))
		.limit(input.limit + 1);
	const hasNext = groupRows.length > input.limit;
	const page = groupRows.slice(0, input.limit);
	const rows =
		page.length === 0
			? []
			: await db
					.select({ entry: s.creditLedger, groupId })
					.from(s.creditLedger)
					.innerJoin(s.creditWallet, eq(s.creditLedger.walletId, s.creditWallet.id))
					.leftJoin(s.aiUsage, eq(s.creditLedger.usageId, s.aiUsage.id))
					.where(
						and(
							eq(s.creditWallet.orgId, orgId),
							inArray(
								groupId,
								page.map((group) => group.id),
							),
						),
					)
					.orderBy(s.creditLedger.createdAt, s.creditLedger.id);
	const entriesByGroup = new Map<string, (typeof s.creditLedger.$inferSelect)[]>();
	for (const row of rows) {
		const entries = entriesByGroup.get(row.groupId);
		if (entries) {
			entries.push(row.entry);
		} else {
			entriesByGroup.set(row.groupId, [row.entry]);
		}
	}
	const groups = page.flatMap((group) => {
		const entries = entriesByGroup.get(group.id);
		return entries ? [{ ...group, entries }] : [];
	});
	const last = groups.at(-1);
	return {
		groups,
		nextCursor: hasNext && last ? { createdAt: last.createdAt, id: last.id } : null,
	};
}

export interface CreditLedgerGroup {
	id: string;
	createdAt: Date;
	entries: (typeof s.creditLedger.$inferSelect)[];
}
