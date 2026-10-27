/* @license Enterprise */

import { and, count, desc, eq, gt, gte, inArray, isNotNull, or, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

export async function listOrganizationCreditMovements(orgId: string, limit: number) {
	return db
		.select({
			id: s.creditLedger.id,
			entryType: s.creditLedger.entryType,
			deltaMicroUsd: s.creditLedger.deltaMicroUsd,
			balanceAfterMicroUsd: s.creditLedger.balanceAfterMicroUsd,
			grantType: s.creditLedger.grantType,
			metadata: s.creditLedger.metadata,
			createdAt: s.creditLedger.createdAt,
		})
		.from(s.creditLedger)
		.innerJoin(s.creditWallet, eq(s.creditWallet.id, s.creditLedger.walletId))
		.where(and(eq(s.creditWallet.orgId, orgId), creditMovementFilter()))
		.orderBy(desc(s.creditLedger.createdAt), desc(s.creditLedger.transactionSequence))
		.limit(limit)
		.execute();
}

export async function getOrganizationCreditTotals(orgId: string, usageSince: Date) {
	const [totals] = await db
		.select({
			purchasedMicroUsd: sumDeltaWhere(sql`${s.creditLedger.entryType} = 'purchase'`),
			giftedMicroUsd: sumDeltaWhere(sql`${s.creditLedger.entryType} = 'gift'`),
			usedSinceMicroUsd: sumDeltaWhere(
				sql`${s.creditLedger.entryType} = 'usage' and ${s.creditLedger.createdAt} >= ${sql.param(usageSince, s.creditLedger.createdAt)}`,
			),
		})
		.from(s.creditLedger)
		.innerJoin(s.creditWallet, eq(s.creditWallet.id, s.creditLedger.walletId))
		.where(eq(s.creditWallet.orgId, orgId))
		.execute();
	return {
		purchasedMicroUsd: Number(totals?.purchasedMicroUsd ?? 0),
		giftedMicroUsd: Number(totals?.giftedMicroUsd ?? 0),
		usedSinceMicroUsd: -Number(totals?.usedSinceMicroUsd ?? 0),
	};
}

export async function getCreditWalletTotals() {
	const [totals] = await db
		.select({
			balanceMicroUsd: sql<number>`coalesce(sum(${s.creditWallet.balanceMicroUsd}), 0)`,
			fundedOrganizations: count(),
		})
		.from(s.creditWallet)
		.where(and(isNotNull(s.creditWallet.orgId), gt(s.creditWallet.balanceMicroUsd, 0)))
		.execute();
	return {
		balanceMicroUsd: Number(totals?.balanceMicroUsd ?? 0),
		fundedOrganizations: Number(totals?.fundedOrganizations ?? 0),
	};
}

export async function listCreditInflowsSince(since: Date) {
	return db
		.select({
			id: s.creditLedger.id,
			entryType: s.creditLedger.entryType,
			deltaMicroUsd: s.creditLedger.deltaMicroUsd,
			metadata: s.creditLedger.metadata,
			createdAt: s.creditLedger.createdAt,
			orgId: s.organization.id,
			orgName: s.organization.name,
		})
		.from(s.creditLedger)
		.innerJoin(s.creditWallet, eq(s.creditWallet.id, s.creditLedger.walletId))
		.innerJoin(s.organization, eq(s.organization.id, s.creditWallet.orgId))
		.where(and(inArray(s.creditLedger.entryType, ['purchase', 'gift']), gte(s.creditLedger.createdAt, since)))
		.orderBy(desc(s.creditLedger.createdAt))
		.execute();
}

export async function getCreditUsageSince(since: Date): Promise<number> {
	const [totals] = await db
		.select({ deltaMicroUsd: sql<number>`coalesce(sum(${s.creditLedger.deltaMicroUsd}), 0)` })
		.from(s.creditLedger)
		.where(and(eq(s.creditLedger.entryType, 'usage'), gte(s.creditLedger.createdAt, since)))
		.execute();
	return -Number(totals?.deltaMicroUsd ?? 0);
}

/** Money moving in or out of the wallet, leaving out per-call usage and the reservation bookkeeping. */
function creditMovementFilter() {
	return or(
		inArray(s.creditLedger.entryType, ['gift', 'purchase', 'referral', 'refund']),
		and(eq(s.creditLedger.entryType, 'adjustment'), isNotNull(s.creditLedger.purchasePaymentIntentId)),
	);
}

function sumDeltaWhere(condition: ReturnType<typeof sql>) {
	return sql<number>`coalesce(sum(case when ${condition} then ${s.creditLedger.deltaMicroUsd} else 0 end), 0)`;
}
