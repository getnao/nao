import type { OrganizationWithBilling } from '../queries/billing.queries';
import * as billingQueries from '../queries/billing.queries';
import { getCreditPurchaseByCheckoutSession } from '../queries/credit-wallet.queries';
import * as userQueries from '../queries/user.queries';
import {
	CLOUD_BILLING_PLANS,
	type CloudBillingCurrency,
	type CloudBillingPlanKey,
	findCloudBillingPlan,
	FREE_TIER_SEAT_LIMIT,
	isCloudBillingPlanKey,
	isTerminalBillingStatus,
	isTrialAvailable,
	type PaidCloudBillingTier,
	TEAM_MAX_SEATS,
	TEAM_MIN_SEATS,
} from '../types/billing';
import { HandlerError } from '../utils/error';
import { logger, serializeError } from '../utils/logger';
import { reconcileCloudBillingCustomer } from './billing-reconciliation.service';
import {
	getOrganizationSeats,
	hasCloudBillingAccess,
	isActiveLocalTrial,
	isActiveTrialWithoutPaidPlan,
	isExpiredTrialWithoutPaidPlan,
} from './cloud-billing-access.service';
import { matchCloudTrialPlaceholderCurrency } from './cloud-trial-provisioning.service';
import { createCreditTopUpCheckoutSession, getCreditTopUpPurchase } from './credit-top-up.service';
import { issueCreditPurchase } from './credit-wallet.service';
import {
	createCloudCheckoutSession,
	createCloudCustomer,
	createCloudPaymentMethodSession,
	createCloudPortalSession,
	createCloudResubscribeSession,
	getCloudSubscriptionCurrency,
	getCloudSubscriptionPlan,
	getCloudUpcomingInvoice,
	listCloudInvoices,
	resumeCloudSubscription,
} from './stripe.service';

export interface AdminBillingInput {
	userId: string;
	organizationId: string;
}

interface AdminBillingRequestInput extends AdminBillingInput {
	requestId: string;
}

interface AdminBillingCheckoutInput extends AdminBillingInput {
	planKey: CloudBillingPlanKey;
	seats?: number;
	currency: CloudBillingCurrency;
}

export class CloudBillingManagementInputError extends HandlerError {
	constructor(message: string) {
		super('BAD_REQUEST', message);
		this.name = 'CloudBillingManagementInputError';
	}
}

export async function getCloudBillingAccessForUser(input: AdminBillingInput & { canManageBilling: boolean }) {
	const organization = await loadCloudBillingOrganization(input.organizationId);
	const billing = organization.billing;
	const { entitlement, candidates, readOnlyUserIds } = await getOrganizationSeats(organization.id);
	return {
		organizationId: organization.id,
		bypassBilling: organization.bypassBilling,
		canManageBilling: input.canManageBilling,
		tier: entitlement.tier,
		seatLimit: entitlement.seatLimit,
		seatUserCount: candidates.length,
		isReadOnly: readOnlyUserIds.has(input.userId),
		hasAccess: hasCloudBillingAccess(billing),
		status: billing?.billingStatus ?? null,
		trialEndsAt: billing?.trialEndsAt ?? null,
		accessEndsAt: entitlement.paidAccessEndsAt,
		trialAvailable: isTrialAvailable(billing),
		requiresBillingAction:
			billing?.billingStatus === 'trialing' &&
			billing.hasDefaultPaymentMethod !== true &&
			candidates.length > FREE_TIER_SEAT_LIMIT,
	};
}

/** `currency` is set while a paid subscription is live, because Stripe never changes a subscription's currency. */
export async function getCloudBillingStatusForAdmin(input: AdminBillingInput) {
	const organization = await loadCloudBillingOrganization(input.organizationId);
	const billing = organization.billing;
	const trialAvailable = isTrialAvailable(billing);
	const paidPlanSelected = Boolean(billing?.stripeSubscriptionId && billing.billingPlan);
	const currentPlanLive = paidPlanSelected && !isTerminalBillingStatus(billing?.billingStatus);
	const subscriptionCurrency =
		currentPlanLive && billing?.stripeSubscriptionId
			? getCloudSubscriptionCurrency(billing.stripeSubscriptionId)
			: null;
	const [currency, plan, { entitlement, candidates, readOnlyUserIds }] = await Promise.all([
		subscriptionCurrency,
		subscriptionCurrency && billing?.stripePriceId
			? subscriptionCurrency.then((currency) => getCloudSubscriptionPlan(billing.stripePriceId!, currency))
			: null,
		getOrganizationSeats(organization.id),
	]);
	const pendingPlan = findCloudBillingPlan(billing?.pendingBillingPlan);
	return {
		currency: currency as CloudBillingCurrency | null,
		plan: plan ? { ...plan, legacy: !isCloudBillingPlanKey(plan.key) } : null,
		seatQuantity: currentPlanLive ? (billing?.seatQuantity ?? null) : null,
		pending: pendingPlan
			? {
					planKey: pendingPlan.key,
					seats: billing?.pendingSeatQuantity ?? null,
					effectiveAt: billing?.currentPeriodEndsAt ?? null,
				}
			: null,
		pendingFreeSeatUserIds: billing?.pendingFreeSeatUserIds ?? null,
		tier: entitlement.tier,
		seatLimit: entitlement.seatLimit,
		members: candidates.map(({ id, name, email, membershipClass }) => ({
			id,
			name,
			email,
			membershipClass,
			seated: !readOnlyUserIds.has(id),
		})),
		recommendation: recommendTier(candidates.length),
		status: billing?.billingStatus ?? null,
		trialStartedAt: billing?.trialStartedAt ?? null,
		trialEndsAt: billing?.trialEndsAt ?? null,
		currentPeriodStartsAt: billing?.currentPeriodStartsAt ?? null,
		currentPeriodEndsAt: billing?.currentPeriodEndsAt ?? null,
		cancellationScheduled: Boolean(billing?.billingPlan && billing.cancellationScheduled),
		hasDefaultPaymentMethod: billing?.hasDefaultPaymentMethod ?? null,
		billingAccessEndsAt: billing?.billingAccessEndsAt ?? null,
		trialAvailable,
		needsPaidPlanSelection: isActiveTrialWithoutPaidPlan(billing),
		paidPlanSelected,
		portalAvailable: Boolean(billing?.stripeCustomerId && paidPlanSelected),
		invoiceHistoryAvailable: Boolean(billing?.stripeCustomerId),
		paymentMethodManagementAvailable: Boolean(billing?.stripeCustomerId && paidPlanSelected),
		resubscribeAvailable:
			isExpiredTrialWithoutPaidPlan(billing) ||
			(!billing?.stripeSubscriptionId && !trialAvailable && !isActiveLocalTrial(billing)) ||
			(Boolean(billing?.stripeCustomerId && billing?.stripeSubscriptionId) &&
				isTerminalBillingStatus(billing?.billingStatus)),
		hasStripeSubscription: Boolean(billing?.stripeSubscriptionId),
	};
}

export async function createCloudTrialCheckoutForAdmin(input: AdminBillingCheckoutInput): Promise<string> {
	const organization = await loadReconciledCloudBillingOrganization(input.organizationId);
	const trialEndsAt = isActiveTrialWithoutPaidPlan(organization.billing) ? organization.billing?.trialEndsAt : null;
	if (!trialEndsAt && !isTrialAvailable(organization.billing)) {
		throw new CloudBillingManagementInputError('This organization has already used its free trial');
	}
	const quantity = planQuantity(input.planKey, input.seats);
	const stripeCustomerId = await ensureCloudCustomer(organization, input.userId);
	if (trialEndsAt) {
		await matchCloudTrialPlaceholderCurrency({
			organizationId: organization.id,
			stripeCustomerId,
			currency: input.currency,
		});
	}
	return createCloudCheckoutSession({
		planKey: input.planKey,
		quantity,
		currency: input.currency,
		organizationId: organization.id,
		stripeCustomerId,
		...(trialEndsAt ? { trialEnd: trialEndsAt } : {}),
	});
}

export async function createCreditTopUpCheckoutForAdmin(
	input: AdminBillingRequestInput & { creditAmountCents: number },
): Promise<string> {
	const organization = await loadCloudBillingOrganization(input.organizationId);
	const stripeCustomerId = await ensureCloudCustomer(organization, input.userId);
	return createCreditTopUpCheckoutSession({
		creditAmountCents: input.creditAmountCents,
		organizationId: organization.id,
		stripeCustomerId,
		initiatingUserId: input.userId,
		requestId: input.requestId,
	});
}

export async function confirmCreditTopUpForAdmin(
	input: AdminBillingInput & { checkoutSessionId: string },
): Promise<boolean> {
	const purchase = await getCreditPurchaseByCheckoutSession(input.checkoutSessionId);
	if (purchase) {
		return purchase.orgId === input.organizationId;
	}
	try {
		return await settleCreditTopUpCheckout(input.checkoutSessionId, input.organizationId);
	} catch (error) {
		logger.warn('Credit top-up confirmation could not settle the Checkout Session', {
			source: 'system',
			context: { checkoutSessionId: input.checkoutSessionId, error: serializeError(error) },
		});
		return false;
	}
}

export async function settleCreditTopUpCheckout(
	checkoutSessionId: string,
	expectedOrganizationId?: string,
): Promise<boolean> {
	const purchase = await getCreditTopUpPurchase(checkoutSessionId);
	if (expectedOrganizationId !== undefined && purchase.organizationId !== expectedOrganizationId) {
		return false;
	}
	const billing = await billingQueries.getOrganizationBilling(purchase.organizationId);
	if (!billing || billing.stripeCustomerId !== purchase.stripeCustomerId) {
		throw new Error(`Stripe Checkout Session "${purchase.checkoutSessionId}" has an unexpected Customer`);
	}
	await issueCreditPurchase({
		checkoutSessionId: purchase.checkoutSessionId,
		paymentIntentId: purchase.paymentIntentId,
		invoiceId: purchase.invoiceId,
		orgId: purchase.organizationId,
		initiatingUserId: purchase.initiatingUserId,
		creditAmountCents: purchase.creditAmountCents,
		platformFeeCents: purchase.platformFeeCents,
		walletAmountMicroUsd: purchase.walletAmountMicroUsd,
		taxAmountCents: purchase.taxAmountCents,
		totalAmountCents: purchase.totalAmountCents,
	});
	return true;
}

export async function listCloudInvoicesForAdmin(input: AdminBillingInput) {
	const organization = await loadCloudBillingOrganization(input.organizationId);
	return organization.billing?.stripeCustomerId ? listCloudInvoices(organization.billing.stripeCustomerId) : [];
}

export async function getCloudUpcomingInvoiceForAdmin(input: AdminBillingInput) {
	const organization = await loadCloudBillingOrganization(input.organizationId);
	return organization.billing?.stripeSubscriptionId && organization.billing.billingPlan
		? getCloudUpcomingInvoice(organization.billing.stripeSubscriptionId)
		: null;
}

export async function syncCloudBillingForAdmin(input: AdminBillingInput): Promise<{ synced: boolean }> {
	const organization = await loadCloudBillingOrganization(input.organizationId);
	if (!organization.billing?.stripeCustomerId) {
		return { synced: false };
	}
	await reconcileCloudBillingCustomer({
		stripeCustomerId: organization.billing.stripeCustomerId,
		organizationIdHint: organization.id,
	});
	return { synced: true };
}

export async function createCloudPortalForAdmin(input: AdminBillingRequestInput): Promise<string> {
	const organization = await loadCloudBillingOrganization(input.organizationId);
	if (
		!organization.billing?.stripeCustomerId ||
		!organization.billing.stripeSubscriptionId ||
		!organization.billing.billingPlan
	) {
		throw new CloudBillingManagementInputError('No Stripe subscription is available to manage');
	}
	return createCloudPortalSession({
		organizationId: organization.id,
		stripeCustomerId: organization.billing.stripeCustomerId,
		requestId: input.requestId,
	});
}

export async function createCloudPaymentMethodPortalForAdmin(input: AdminBillingRequestInput): Promise<string> {
	const organization = await loadCloudBillingOrganization(input.organizationId);
	if (!organization.billing?.stripeCustomerId || !organization.billing.billingPlan) {
		throw new CloudBillingManagementInputError('No Stripe subscription is available to manage');
	}
	return createCloudPaymentMethodSession({
		organizationId: organization.id,
		stripeCustomerId: organization.billing.stripeCustomerId,
		requestId: input.requestId,
	});
}

export async function createCloudResubscribeForAdmin(input: AdminBillingCheckoutInput): Promise<string> {
	const organization = await loadReconciledCloudBillingOrganization(input.organizationId);
	const billing = organization.billing;
	const isMissingSubscriptionRecovery =
		!billing?.stripeSubscriptionId &&
		Boolean(billing?.billingStatus || billing?.trialStartedAt || billing?.trialEndsAt);
	if (
		billing?.stripeSubscriptionId
			? !billing.stripeCustomerId || !isTerminalBillingStatus(billing.billingStatus)
			: !isMissingSubscriptionRecovery
	) {
		throw new CloudBillingManagementInputError('A new subscription is not available');
	}
	const quantity = planQuantity(input.planKey, input.seats);
	const stripeCustomerId = await ensureCloudCustomer(organization, input.userId);
	return createCloudResubscribeSession({
		planKey: input.planKey,
		quantity,
		currency: input.currency,
		organizationId: organization.id,
		stripeCustomerId,
		allowMissingHistory: isMissingSubscriptionRecovery,
	});
}

export async function resumeCloudSubscriptionForAdmin(input: AdminBillingRequestInput): Promise<void> {
	const organization = await loadCloudBillingOrganization(input.organizationId);
	if (!organization.billing?.stripeSubscriptionId || !organization.billing.billingPlan) {
		throw new CloudBillingManagementInputError('No Stripe subscription is available to resume');
	}
	await resumeCloudSubscription({
		organizationId: organization.id,
		stripeSubscriptionId: organization.billing.stripeSubscriptionId,
		requestId: input.requestId,
	});
}

function recommendTier(seatUserCount: number): PaidCloudBillingTier {
	const teamCost = CLOUD_BILLING_PLANS.cloud_team_monthly_v1.unitAmount * Math.max(TEAM_MIN_SEATS, seatUserCount);
	return teamCost >= CLOUD_BILLING_PLANS.cloud_unlimited_monthly_v1.unitAmount ? 'unlimited' : 'team';
}

/** Team is billed per seat within its bounds; Unlimited is a single flat-priced item. */
export function planQuantity(planKey: CloudBillingPlanKey, seats: number | undefined): number {
	if (CLOUD_BILLING_PLANS[planKey].tier === 'unlimited') {
		return 1;
	}
	if (seats === undefined || !Number.isInteger(seats) || seats < TEAM_MIN_SEATS || seats > TEAM_MAX_SEATS) {
		throw new CloudBillingManagementInputError(`Team needs between ${TEAM_MIN_SEATS} and ${TEAM_MAX_SEATS} seats`);
	}
	return seats;
}

export async function loadCloudBillingOrganization(organizationId: string): Promise<OrganizationWithBilling> {
	const organization = await billingQueries.getOrganizationWithBilling(organizationId);
	if (!organization) {
		throw new HandlerError('NOT_FOUND', 'Organization was not found');
	}
	return organization;
}

async function loadReconciledCloudBillingOrganization(organizationId: string): Promise<OrganizationWithBilling> {
	const organization = await loadCloudBillingOrganization(organizationId);
	if (!organization.billing?.stripeCustomerId) {
		return organization;
	}
	await reconcileCloudBillingCustomer({
		stripeCustomerId: organization.billing.stripeCustomerId,
		organizationIdHint: organization.id,
	});
	return loadCloudBillingOrganization(organizationId);
}

async function ensureCloudCustomer(organization: OrganizationWithBilling, userId: string): Promise<string> {
	if (organization.billing?.stripeCustomerId) {
		return organization.billing.stripeCustomerId;
	}
	const user = await userQueries.getUser({ id: userId });
	if (!user) {
		throw new Error(`User "${userId}" was not found`);
	}
	const customer = await createCloudCustomer({
		organizationId: organization.id,
		organizationName: organization.name,
		adminEmail: user.email,
	});
	const updated = await billingQueries.attachStripeCustomer(organization.id, customer.id);
	if (!updated.stripeCustomerId) {
		throw new Error('Unable to attach Stripe Customer');
	}
	return updated.stripeCustomerId;
}
