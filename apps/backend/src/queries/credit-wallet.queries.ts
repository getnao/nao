import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import type { CreditGrantType } from '../types/managed-ai-usage';
import * as userQueries from './user.queries';

export type CreditLedgerCursor = { createdAt: Date; id: string };

export async function getCreditPurchaseByCheckoutSession(
	checkoutSessionId: string,
): Promise<{ orgId: string | null; entry: typeof s.creditLedger.$inferSelect } | null> {
	const [purchase] = await db
		.select({ orgId: s.creditWallet.orgId, entry: s.creditLedger })
		.from(s.creditLedger)
		.innerJoin(s.creditWallet, eq(s.creditLedger.walletId, s.creditWallet.id))
		.where(eq(s.creditLedger.idempotencyKey, `purchase:stripe:${checkoutSessionId}`))
		.limit(1);
	return purchase ?? null;
}

export async function getCreditPurchaseByPaymentIntent(
	paymentIntentId: string,
): Promise<{ orgId: string | null; entry: typeof s.creditLedger.$inferSelect } | null> {
	const [purchase] = await db
		.select({ orgId: s.creditWallet.orgId, entry: s.creditLedger })
		.from(s.creditLedger)
		.innerJoin(s.creditWallet, eq(s.creditLedger.walletId, s.creditWallet.id))
		.where(and(eq(s.creditLedger.entryType, 'purchase'), eq(s.creditLedger.externalReference, paymentIntentId)))
		.limit(1);
	return purchase ?? null;
}

export async function getCreditGrant(
	grantType: CreditGrantType,
	subjectId: string,
): Promise<{ orgId: string | null } | null> {
	const idempotencyKey =
		grantType === 'organization_setup' ? `organization-setup:v0:${subjectId}` : `user-join:v0:${subjectId}`;
	const [grant] = await db
		.select({ orgId: s.creditWallet.orgId })
		.from(s.creditLedger)
		.innerJoin(s.creditWallet, eq(s.creditLedger.walletId, s.creditWallet.id))
		.where(eq(s.creditLedger.idempotencyKey, idempotencyKey))
		.limit(1);
	return grant ?? null;
}

export async function getCreditSummary(orgId: string): Promise<{
	balanceMicroUsd: number;
	lifetimeCreditedMicroUsd: number;
	lifetimeDebitedMicroUsd: number;
}> {
	const [wallet] = await db.select().from(s.creditWallet).where(eq(s.creditWallet.orgId, orgId)).limit(1);
	if (!wallet) {
		return { balanceMicroUsd: 0, lifetimeCreditedMicroUsd: 0, lifetimeDebitedMicroUsd: 0 };
	}
	const [totals] = await db
		.select({
			credited: sql<number>`coalesce(sum(case when ${s.creditLedger.deltaMicroUsd} > 0 then ${s.creditLedger.deltaMicroUsd} else 0 end), 0)`,
			debited: sql<number>`coalesce(sum(case when ${s.creditLedger.deltaMicroUsd} < 0 then -${s.creditLedger.deltaMicroUsd} else 0 end), 0)`,
		})
		.from(s.creditLedger)
		.where(and(eq(s.creditLedger.walletId, wallet.id), ne(s.creditLedger.entryType, 'reservation')));
	return {
		balanceMicroUsd: wallet.balanceMicroUsd,
		lifetimeCreditedMicroUsd: Number(totals?.credited ?? 0),
		lifetimeDebitedMicroUsd: Number(totals?.debited ?? 0),
	};
}

export async function listCreditLedger(
	orgId: string,
	input: { cursor?: CreditLedgerCursor; limit: number },
): Promise<{ groups: CreditLedgerGroup[]; nextCursor: CreditLedgerCursor | null }> {
	const groupId = sql<string>`coalesce(${s.managedAiUsage.runId}, ${s.creditLedger.id})`;
	const latestCreatedAt = sql<Date>`max(${s.creditLedger.createdAt})`.mapWith(s.creditLedger.createdAt);
	const cursorCreatedAt = input.cursor && sql.param(input.cursor.createdAt, s.creditLedger.createdAt);
	const groupRows = await db
		.select({ id: groupId, createdAt: latestCreatedAt })
		.from(s.creditLedger)
		.innerJoin(s.creditWallet, eq(s.creditLedger.walletId, s.creditWallet.id))
		.leftJoin(s.managedAiUsage, eq(s.creditLedger.usageId, s.managedAiUsage.id))
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
					.select({
						entry: s.creditLedger,
						groupId,
						usageUserName: s.user.name,
					})
					.from(s.creditLedger)
					.innerJoin(s.creditWallet, eq(s.creditLedger.walletId, s.creditWallet.id))
					.leftJoin(s.managedAiUsage, eq(s.creditLedger.usageId, s.managedAiUsage.id))
					.leftJoin(s.user, eq(s.managedAiUsage.userId, s.user.id))
					.where(
						and(
							eq(s.creditWallet.orgId, orgId),
							inArray(
								groupId,
								page.map((group) => group.id),
							),
						),
					)
					.orderBy(s.creditLedger.transactionSequence, s.creditLedger.id);
	const grantedForUserIds = rows
		.map(({ entry }) => getGrantedForUserId(entry))
		.filter((userId): userId is string => userId !== null);
	const grantedForUserNames = await userQueries.getUserNames([...new Set(grantedForUserIds)]);
	const entriesByGroup = new Map<string, (typeof s.creditLedger.$inferSelect)[]>();
	const usageUserNamesByGroup = new Map<string, string | null>();
	for (const row of rows) {
		const entries = entriesByGroup.get(row.groupId);
		if (entries) {
			entries.push(row.entry);
		} else {
			entriesByGroup.set(row.groupId, [row.entry]);
		}
		if (row.entry.entryType === 'usage' && !usageUserNamesByGroup.has(row.groupId)) {
			usageUserNamesByGroup.set(row.groupId, row.usageUserName);
		}
	}
	const groups = page.flatMap((group) => {
		const entries = entriesByGroup.get(group.id);
		if (!entries) {
			return [];
		}
		const grantedForUserId = entries.map(getGrantedForUserId).find((userId) => userId !== null);
		return [
			{
				...group,
				entries,
				grantedForUserName: grantedForUserId ? (grantedForUserNames.get(grantedForUserId) ?? null) : null,
				usageUserName: usageUserNamesByGroup.get(group.id) ?? null,
			},
		];
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
	grantedForUserName: string | null;
	usageUserName: string | null;
}

function getGrantedForUserId(entry: typeof s.creditLedger.$inferSelect): string | null {
	const userId = entry.metadata?.grantedForUserId;
	return typeof userId === 'string' ? userId : null;
}
