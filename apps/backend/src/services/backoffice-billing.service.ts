/* @license Enterprise */

import type { DBOrganizationBilling } from '../db/abstractSchema';
import { isCloudBillingEnabled } from '../env';
import * as backofficeBillingQueries from '../queries/backoffice-billing.queries';
import * as billingQueries from '../queries/billing.queries';
import { type BillingStatus, CLOUD_BILLING_PLANS, type CloudBillingInterval } from '../types/billing';
import { HandlerError } from '../utils/error';
import { logger } from '../utils/logger';
import { getCloudBillingAccessEndsAt, hasCloudBillingAccess } from './cloud-billing-access.service';
import type { CloudSubscriptionRevenue, StripeAccountInvoice } from './stripe.service';
import * as stripeService from './stripe.service';

const DAY_MS = 24 * 60 * 60 * 1_000;
const REVENUE_MONTHS = 12;
const RECENT_INVOICE_LIMIT = 30;
const RECENT_EVENT_LIMIT = 50;

type MoneyByCurrency = Record<string, number>;
type OrganizationWithBillingRow = Awaited<
	ReturnType<typeof backofficeBillingQueries.listOrganizationsWithBilling>
>[number];

export type BackofficeBillingState =
	| 'paying'
	| 'trialing'
	| 'past_due'
	| 'paused'
	| 'unpaid'
	| 'incomplete'
	| 'churned'
	| 'bypassed'
	| 'none';

export function toBillingSummary(bypassBilling: boolean, billing: DBOrganizationBilling | null) {
	return {
		state: billingState(bypassBilling, billing?.billingStatus ?? null),
		status: billing?.billingStatus ?? null,
		plan: billing?.billingPlan ?? null,
		interval: billingInterval(billing?.billingPlan ?? null),
		hasAccess: !isCloudBillingEnabled() || bypassBilling || hasCloudBillingAccess(billing),
		accessEndsAt: getCloudBillingAccessEndsAt(billing),
		trialStartedAt: billing?.trialStartedAt ?? null,
		trialEndsAt: billing?.trialEndsAt ?? null,
		currentPeriodStartsAt: billing?.currentPeriodStartsAt ?? null,
		currentPeriodEndsAt: billing?.currentPeriodEndsAt ?? null,
		cancellationScheduled: billing?.cancellationScheduled ?? false,
		hasDefaultPaymentMethod: billing?.hasDefaultPaymentMethod ?? false,
		stripeCustomerId: billing?.stripeCustomerId ?? null,
		stripeSubscriptionId: billing?.stripeSubscriptionId ?? null,
		updatedAt: billing?.billingUpdatedAt ?? null,
	};
}

export async function getOrganizationBillingDetail(orgId: string) {
	const organization = await billingQueries.getOrganizationWithBilling(orgId);
	if (!organization) {
		throw new HandlerError('NOT_FOUND', 'Organization not found');
	}
	const billing = toBillingSummary(organization.bypassBilling, organization.billing);
	const stripeCustomerId = organization.billing?.stripeCustomerId;
	if (!isCloudBillingEnabled() || !organization.billing || !stripeCustomerId) {
		return { billing, stripe: null, stripeError: null };
	}
	try {
		const stripe = await loadOrganizationStripeDetail(organization.billing, stripeCustomerId);
		return { billing, stripe, stripeError: null };
	} catch (error) {
		return { billing, stripe: null, stripeError: describeStripeFailure('organization billing', error) };
	}
}

export async function getBillingOverview() {
	const [organizations, events] = await Promise.all([
		backofficeBillingQueries.listOrganizationsWithBilling(),
		backofficeBillingQueries.listRecentStripeWebhookEvents(RECENT_EVENT_LIMIT),
	]);
	const billingEnabled = isCloudBillingEnabled();
	return {
		billingEnabled,
		stripeMode: billingEnabled ? (stripeService.isStripeLiveMode() ? 'live' : 'test') : null,
		organizations: organizations.map(({ billing, ...organization }) => ({
			...organization,
			billing: toBillingSummary(organization.bypassBilling, billing),
		})),
		events,
		...(billingEnabled ? await loadRevenue(organizations) : { revenue: null, stripeError: null }),
	};
}

function billingState(bypassBilling: boolean, status: BillingStatus | null): BackofficeBillingState {
	switch (status) {
		case 'active':
			return 'paying';
		case 'trialing':
		case 'past_due':
		case 'paused':
		case 'unpaid':
		case 'incomplete':
			return status;
	}
	if (bypassBilling) {
		return 'bypassed';
	}
	return status ? 'churned' : 'none';
}

function billingInterval(plan: string | null): CloudBillingInterval | null {
	const entry = Object.entries(CLOUD_BILLING_PLANS).find(([, definition]) => definition.key === plan);
	return entry ? (entry[0] as CloudBillingInterval) : null;
}

async function loadOrganizationStripeDetail(billing: DBOrganizationBilling, stripeCustomerId: string) {
	const subscriptionId = billing.stripeSubscriptionId;
	const [plan, invoices, upcomingInvoice] = await Promise.all([
		loadSubscriptionPlan(billing),
		stripeService.listCloudInvoices(stripeCustomerId),
		subscriptionId ? stripeService.getCloudUpcomingInvoice(subscriptionId).catch(() => null) : null,
	]);
	return {
		customerUrl: stripeService.stripeDashboardUrl(`customers/${stripeCustomerId}`),
		subscriptionUrl: subscriptionId ? stripeService.stripeDashboardUrl(`subscriptions/${subscriptionId}`) : null,
		plan,
		upcomingInvoice,
		invoices,
	};
}

async function loadSubscriptionPlan(billing: DBOrganizationBilling) {
	if (!billing.billingPlan || !billing.stripePriceId || !billing.stripeSubscriptionId) {
		return null;
	}
	const currency = await stripeService.getCloudSubscriptionCurrency(billing.stripeSubscriptionId);
	const { subscriptionPlan } = await stripeService.getCloudBillingPlans(billing.stripePriceId, 'usd', currency);
	return subscriptionPlan;
}

async function loadRevenue(organizations: OrganizationWithBillingRow[]) {
	const organizationsByCustomer = new Map(
		organizations.flatMap((organization) =>
			organization.billing?.stripeCustomerId
				? [[organization.billing.stripeCustomerId, organization] as const]
				: [],
		),
	);
	const belongsToOrganization = (item: { stripeCustomerId: string | null }) =>
		item.stripeCustomerId !== null && organizationsByCustomer.has(item.stripeCustomerId);
	try {
		const [invoices, subscriptions] = await Promise.all([
			stripeService.listStripeInvoicesCreatedSince(revenueWindowStart()),
			stripeService.listCurrentCloudSubscriptions(),
		]);
		const organizationInvoices = invoices.filter(belongsToOrganization);
		return {
			revenue: {
				...summarizeRevenue(organizationInvoices, subscriptions.filter(belongsToOrganization)),
				recentInvoices: organizationInvoices
					.filter((invoice) => invoice.status !== 'draft')
					.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
					.slice(0, RECENT_INVOICE_LIMIT)
					.map((invoice) => {
						const organization = organizationsByCustomer.get(invoice.stripeCustomerId!)!;
						return { ...invoice, orgId: organization.id, orgName: organization.name };
					}),
			},
			stripeError: null,
		};
	} catch (error) {
		return { revenue: null, stripeError: describeStripeFailure('billing overview', error) };
	}
}

function summarizeRevenue(invoices: StripeAccountInvoice[], subscriptions: CloudSubscriptionRevenue[]) {
	const paidInvoices = invoices.filter(
		(invoice): invoice is StripeAccountInvoice & { paidAt: Date } =>
			invoice.status === 'paid' && invoice.paidAt !== null,
	);
	const last30d = Date.now() - 30 * DAY_MS;
	const billedSubscriptions = subscriptions.filter(
		(subscription) => subscription.status === 'active' || subscription.status === 'past_due',
	);
	return {
		mrr: sumByCurrency(billedSubscriptions, (subscription) => subscription.monthlyAmount),
		trialMrr: sumByCurrency(
			subscriptions.filter((subscription) => subscription.status === 'trialing'),
			(subscription) => subscription.monthlyAmount,
		),
		collected30d: sumByCurrency(
			paidInvoices.filter((invoice) => invoice.paidAt.getTime() >= last30d),
			(invoice) => invoice.amountPaid,
		),
		collected12m: sumByCurrency(paidInvoices, (invoice) => invoice.amountPaid),
		monthly: revenueMonths().map((month) => ({
			month,
			amounts: sumByCurrency(
				paidInvoices.filter((invoice) => monthKey(invoice.paidAt) === month),
				(invoice) => invoice.amountPaid,
			),
		})),
	};
}

function sumByCurrency<T extends { currency: string }>(items: T[], amountOf: (item: T) => number): MoneyByCurrency {
	const totals: MoneyByCurrency = {};
	for (const item of items) {
		totals[item.currency] = (totals[item.currency] ?? 0) + amountOf(item);
	}
	return totals;
}

function revenueWindowStart(): Date {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (REVENUE_MONTHS - 1), 1));
}

function revenueMonths(): string[] {
	const start = revenueWindowStart();
	return Array.from({ length: REVENUE_MONTHS }, (_, index) =>
		monthKey(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1))),
	);
}

function monthKey(date: Date): string {
	return date.toISOString().slice(0, 7);
}

function describeStripeFailure(action: string, error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	logger.warn(`Backoffice Stripe ${action} failed: ${message}`, { source: 'system' });
	return message;
}
