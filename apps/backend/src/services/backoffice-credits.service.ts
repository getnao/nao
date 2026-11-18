/* @license Enterprise */

import { isManagedAiEnabled } from '../agents/managed-ai';
import { isCloudBillingEnabled } from '../env';
import * as backofficeCreditsQueries from '../queries/backoffice-credits.queries';
import * as billingQueries from '../queries/billing.queries';
import * as creditWalletQueries from '../queries/credit-wallet.queries';
import { HandlerError } from '../utils/error';
import { issueBackofficeCreditTopUp } from './credit-wallet.service';
import * as stripeService from './stripe.service';

const DAY_MS = 24 * 60 * 60 * 1_000;
const MICRO_USD_PER_CENT = 10_000;
const MOVEMENT_LIMIT = 100;
const RECENT_TOP_UP_LIMIT = 30;

type CreditMovementRow = Awaited<ReturnType<typeof backofficeCreditsQueries.listOrganizationCreditMovements>>[number];
type CreditInflowRow = Awaited<ReturnType<typeof backofficeCreditsQueries.listCreditInflowsSince>>[number];
type CreditMetadata = Record<string, unknown>;

export type CreditMovementKind =
	| 'purchase'
	| 'backoffice_top_up'
	| 'organization_setup_grant'
	| 'user_join_grant'
	| 'gift'
	| 'referral'
	| 'refund'
	| 'dispute';

export interface BackofficeCreditTopUpInput {
	amountCents: number;
	reason: string;
	grantedBy: string;
	requestId: string;
}

export async function getOrganizationCredits(orgId: string) {
	await requireOrganization(orgId);
	const [summary, totals, movements] = await Promise.all([
		creditWalletQueries.getCreditSummary(orgId),
		backofficeCreditsQueries.getOrganizationCreditTotals(orgId, daysAgo(30)),
		backofficeCreditsQueries.listOrganizationCreditMovements(orgId, MOVEMENT_LIMIT),
	]);
	return {
		managedAiEnabled: isManagedAiEnabled(),
		...summary,
		purchasedMicroUsd: totals.purchasedMicroUsd,
		giftedMicroUsd: totals.giftedMicroUsd,
		used30dMicroUsd: totals.usedSinceMicroUsd,
		movements: movements.map(toCreditMovement),
	};
}

export async function topUpOrganizationCredits(orgId: string, input: BackofficeCreditTopUpInput) {
	await requireOrganization(orgId);
	await issueBackofficeCreditTopUp({
		orgId,
		amountMicroUsd: input.amountCents * MICRO_USD_PER_CENT,
		requestId: input.requestId,
		grantedBy: input.grantedBy,
		reason: input.reason,
	});
	return getOrganizationCredits(orgId);
}

export async function getCreditsOverview() {
	const last30d = daysAgo(30);
	const [wallets, inflows, used30dMicroUsd] = await Promise.all([
		backofficeCreditsQueries.getCreditWalletTotals(),
		backofficeCreditsQueries.listCreditInflowsSince(daysAgo(365)),
		backofficeCreditsQueries.getCreditUsageSince(last30d),
	]);
	const purchases = inflows.filter((inflow) => inflow.entryType === 'purchase');
	const backofficeTopUps = inflows.filter(isBackofficeTopUp);
	const isRecent = (inflow: CreditInflowRow) => inflow.createdAt >= last30d;
	return {
		outstandingBalanceMicroUsd: wallets.balanceMicroUsd,
		fundedOrganizations: wallets.fundedOrganizations,
		purchased30dMicroUsd: sumDelta(purchases.filter(isRecent)),
		purchased12mMicroUsd: sumDelta(purchases),
		purchaseCount12m: purchases.length,
		platformFees12mCents: purchases.reduce(
			(total, purchase) => total + (numberField(purchase.metadata, 'platformFeeCents') ?? 0),
			0,
		),
		gifted30dMicroUsd: sumDelta(inflows.filter((inflow) => inflow.entryType === 'gift' && isRecent(inflow))),
		backofficeTopUps30dMicroUsd: sumDelta(backofficeTopUps.filter(isRecent)),
		used30dMicroUsd,
		recentTopUps: inflows
			.filter((inflow) => inflow.entryType === 'purchase' || isBackofficeTopUp(inflow))
			.slice(0, RECENT_TOP_UP_LIMIT)
			.map((inflow) => ({
				id: inflow.id,
				kind: inflow.entryType === 'purchase' ? ('purchase' as const) : ('backoffice_top_up' as const),
				orgId: inflow.orgId,
				orgName: inflow.orgName,
				amountMicroUsd: inflow.deltaMicroUsd,
				totalAmountCents: numberField(inflow.metadata, 'totalAmountCents'),
				grantedBy: stringField(inflow.metadata, 'grantedBy'),
				reason: stringField(inflow.metadata, 'reason'),
				invoiceUrl: stripeInvoiceUrl(inflow.metadata),
				createdAt: inflow.createdAt,
			})),
	};
}

function toCreditMovement(row: CreditMovementRow) {
	return {
		id: row.id,
		kind: creditMovementKind(row),
		deltaMicroUsd: row.deltaMicroUsd,
		balanceAfterMicroUsd: row.balanceAfterMicroUsd,
		grantedBy: stringField(row.metadata, 'grantedBy'),
		reason: stringField(row.metadata, 'reason'),
		totalAmountCents: numberField(row.metadata, 'totalAmountCents'),
		invoiceUrl: stripeInvoiceUrl(row.metadata),
		createdAt: row.createdAt,
	};
}

function creditMovementKind(row: CreditMovementRow): CreditMovementKind {
	switch (row.entryType) {
		case 'purchase':
		case 'referral':
		case 'refund':
			return row.entryType;
		case 'gift':
			return giftKind(row);
		default:
			return 'dispute';
	}
}

function giftKind(row: CreditMovementRow): CreditMovementKind {
	if (row.metadata?.source === 'backoffice') {
		return 'backoffice_top_up';
	}
	if (row.grantType === 'organization_setup') {
		return 'organization_setup_grant';
	}
	return row.grantType === 'user_join' ? 'user_join_grant' : 'gift';
}

function isBackofficeTopUp(inflow: CreditInflowRow): boolean {
	return inflow.entryType === 'gift' && inflow.metadata?.source === 'backoffice';
}

function stripeInvoiceUrl(metadata: CreditMetadata | null): string | null {
	const invoiceId = stringField(metadata, 'invoiceId');
	return invoiceId && isCloudBillingEnabled() ? stripeService.stripeDashboardUrl(`invoices/${invoiceId}`) : null;
}

function stringField(metadata: CreditMetadata | null, key: string): string | null {
	const value = metadata?.[key];
	return typeof value === 'string' ? value : null;
}

function numberField(metadata: CreditMetadata | null, key: string): number | null {
	const value = metadata?.[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sumDelta(rows: Array<{ deltaMicroUsd: number }>): number {
	return rows.reduce((total, row) => total + row.deltaMicroUsd, 0);
}

function daysAgo(days: number): Date {
	return new Date(Date.now() - days * DAY_MS);
}

async function requireOrganization(orgId: string): Promise<void> {
	if (!(await billingQueries.getOrganizationWithBilling(orgId))) {
		throw new HandlerError('NOT_FOUND', 'Organization not found');
	}
}
