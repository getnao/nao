import { isCloudFreeTierEnabled } from '../env';
import { getOrganizationBilling, type OrganizationWithBilling } from '../queries/billing.queries';
import {
	CLOUD_BILLING_PLANS,
	type CloudBillingCurrency,
	FREE_TIER_SEAT_LIMIT,
	isCloudBillingPlanKey,
	isLegacyCloudBillingPlanKey,
	isTerminalBillingStatus,
	isTrialAvailable,
	LEGACY_CLOUD_BILLING_PLANS,
	TEAM_MIN_SEATS,
} from '../types/billing';
import { HandlerError } from '../utils/error';
import { enforcedSeatLimit } from '../utils/seat-allocation';
import { loadCloudBillingOrganization } from './billing-management.service';
import {
	type CloudEntitlement,
	getOrganizationCloudEntitlement,
	isActiveLocalTrial,
	isActiveTrialWithoutPaidPlan,
	isExpiredTrialWithoutPaidPlan,
	isUserReadOnlyInOrganization,
} from './cloud-billing-access.service';
import { loadSeatCandidates } from './organization-seat.service';
import { getCloudBillingPlans, getCloudSubscriptionCurrency, getCurrentCloudBillingPlans } from './stripe.service';

type Billing = OrganizationWithBilling['billing'];
type CurrentCloudBillingPlan = Awaited<ReturnType<typeof getCurrentCloudBillingPlans>>[number];

interface BillingAccessInput {
	organization: Pick<OrganizationWithBilling, 'id' | 'bypassBilling'>;
	userId: string;
	canManageBilling: boolean;
}

export async function getCloudBillingAccess(input: BillingAccessInput) {
	const [billing, entitlement] = await Promise.all([
		getOrganizationBilling(input.organization.id),
		loadCloudEntitlement(input.organization.id),
	]);
	return buildCloudBillingAccess(input, billing, entitlement);
}

export async function getLegacyCloudBillingStatus(organizationId: string, currency: CloudBillingCurrency) {
	const { billing } = await loadCloudBillingOrganization(organizationId);
	const paidPlanSelected = isPaidPlanSelected(billing);
	const subscriptionCurrency =
		paidPlanSelected && billing?.stripeSubscriptionId
			? await getCloudSubscriptionCurrency(billing.stripeSubscriptionId)
			: null;
	const { availablePlans, subscriptionPlan } = await getCloudBillingPlans(
		paidPlanSelected ? (billing?.stripePriceId ?? null) : null,
		currency,
		subscriptionCurrency,
	);
	return {
		plan:
			subscriptionPlan ?? Object.values(availablePlans).find((plan) => plan.key === billing?.billingPlan) ?? null,
		availablePlans,
		...buildSubscriptionSummary(billing),
		portalAvailable: Boolean(billing?.stripeCustomerId && paidPlanSelected),
		paymentMethodManagementAvailable: Boolean(billing?.stripeCustomerId && paidPlanSelected),
	};
}

export async function getCloudBillingStatus(input: {
	organizationId: string;
	userId: string;
	currency: CloudBillingCurrency;
}) {
	const organization = await loadCloudBillingOrganization(input.organizationId);
	const { billing } = organization;
	const entitlement = await loadCloudEntitlement(organization.id);
	const [availablePlans, seats, subscriptionCurrency, access] = await Promise.all([
		getCurrentCloudBillingPlans(input.currency),
		loadSeatCandidates(organization.id, enforcedSeatLimit(entitlement)),
		isPaidPlanSelected(billing) && billing?.stripeSubscriptionId
			? getCloudSubscriptionCurrency(billing.stripeSubscriptionId)
			: Promise.resolve(null),
		buildCloudBillingAccess({ organization, userId: input.userId, canManageBilling: true }, billing, entitlement),
	]);
	const monthlyUnlimited = findPlan(availablePlans, 'unlimited', 'monthly');
	const yearlyUnlimited = findPlan(availablePlans, 'unlimited', 'yearly');
	if (!monthlyUnlimited || !yearlyUnlimited) {
		throw new Error('Stripe did not return both Unlimited billing intervals');
	}
	const currentOffer = availablePlans.find(({ planKey }) => planKey === billing?.billingPlan);
	return {
		access,
		plan: currentOffer ? toLegacyCompatiblePlan(currentOffer) : null,
		availablePlans: Object.assign(availablePlans, {
			monthly: toLegacyCompatiblePlan(monthlyUnlimited),
			yearly: toLegacyCompatiblePlan(yearlyUnlimited),
		}),
		...buildSubscriptionSummary(billing),
		billingUpdatedAt: billing?.billingUpdatedAt ?? null,
		currentPeriodStartsAt: billing?.currentPeriodStartsAt ?? null,
		scheduleConflict: Boolean(billing?.stripeSubscriptionScheduleId),
		current: describeCurrentPlan(billing, subscriptionCurrency ?? input.currency),
		pending: describePendingPlan(billing),
		...seats,
		recommendation: recommendTier(availablePlans, entitlement.seatUserCount, monthlyUnlimited),
		portalAvailable: Boolean(billing?.stripeCustomerId && billing.billingPlan),
		paymentMethodManagementAvailable: Boolean(billing?.stripeCustomerId && billing.billingPlan),
	};
}

async function loadCloudEntitlement(organizationId: string): Promise<CloudEntitlement> {
	const entitlement = await getOrganizationCloudEntitlement(organizationId);
	if (!entitlement) {
		throw new HandlerError('NOT_FOUND', 'Organization was not found');
	}
	return entitlement;
}

async function buildCloudBillingAccess(input: BillingAccessInput, billing: Billing, entitlement: CloudEntitlement) {
	const freeTierEnabled = isCloudFreeTierEnabled();
	return {
		organizationId: input.organization.id,
		hasAccess: entitlement.hasAccess,
		bypassBilling: input.organization.bypassBilling,
		canManageBilling: input.canManageBilling,
		tier: entitlement.tier,
		status: billing?.billingStatus ?? null,
		billingPlan: billing?.billingPlan ?? null,
		trialEndsAt: billing?.trialEndsAt ?? null,
		accessEndsAt: entitlement.paidAccessEndsAt,
		seatUserCount: entitlement.seatUserCount,
		seatQuantity: entitlement.seatQuantity,
		seatLimit: entitlement.seatLimit,
		availableSeats: entitlement.availableSeats,
		overCapacity: entitlement.overCapacity,
		isReadOnly: await isUserReadOnlyInOrganization(input.organization.id, input.userId, entitlement),
		trialAvailable: isTrialAvailable(billing),
		requiresBillingAction:
			billing?.billingStatus === 'trialing' &&
			billing.hasDefaultPaymentMethod !== true &&
			(!freeTierEnabled || entitlement.seatUserCount > FREE_TIER_SEAT_LIMIT),
		freeTierEnabled,
	};
}

function buildSubscriptionSummary(billing: Billing) {
	const trialAvailable = isTrialAvailable(billing);
	return {
		planKey: billing?.billingPlan ?? null,
		status: billing?.billingStatus ?? null,
		trialStartedAt: billing?.trialStartedAt ?? null,
		trialEndsAt: billing?.trialEndsAt ?? null,
		currentPeriodEndsAt: billing?.currentPeriodEndsAt ?? null,
		cancellationScheduled: Boolean(billing?.billingPlan && billing.cancellationScheduled),
		hasDefaultPaymentMethod: billing?.hasDefaultPaymentMethod ?? null,
		billingAccessEndsAt: billing?.billingAccessEndsAt ?? null,
		canManageBilling: true,
		trialAvailable,
		needsPaidPlanSelection: isActiveTrialWithoutPaidPlan(billing),
		paidPlanSelected: isPaidPlanSelected(billing),
		invoiceHistoryAvailable: Boolean(billing?.stripeCustomerId),
		resubscribeAvailable:
			isExpiredTrialWithoutPaidPlan(billing) ||
			(!billing?.stripeSubscriptionId && !trialAvailable && !isActiveLocalTrial(billing)) ||
			(Boolean(billing?.stripeCustomerId && billing.stripeSubscriptionId) &&
				isTerminalBillingStatus(billing?.billingStatus)),
		hasStripeSubscription: Boolean(billing?.stripeSubscriptionId),
	};
}

function describeCurrentPlan(billing: Billing, currency: string) {
	if (!billing?.billingPlan || isTerminalBillingStatus(billing.billingStatus)) {
		return null;
	}
	const definition = isCloudBillingPlanKey(billing.billingPlan)
		? CLOUD_BILLING_PLANS[billing.billingPlan]
		: isLegacyCloudBillingPlanKey(billing.billingPlan)
			? LEGACY_CLOUD_BILLING_PLANS[billing.billingPlan]
			: null;
	if (!definition) {
		return null;
	}
	return {
		planKey: definition.key,
		tier: definition.tier,
		interval: toBillingInterval(definition.interval),
		legacy: 'legacy' in definition && definition.legacy === true,
		currency,
		seatQuantity: billing.seatQuantity ?? null,
	};
}

function describePendingPlan(billing: Billing) {
	if (!billing?.pendingBillingPlan || !isCloudBillingPlanKey(billing.pendingBillingPlan)) {
		return null;
	}
	const definition = CLOUD_BILLING_PLANS[billing.pendingBillingPlan];
	return {
		planKey: definition.key,
		tier: definition.tier,
		interval: toBillingInterval(definition.interval),
		seatQuantity: billing.pendingSeatQuantity ?? null,
		effectiveAt: billing.currentPeriodEndsAt ?? null,
	};
}

function recommendTier(
	availablePlans: CurrentCloudBillingPlan[],
	seatUserCount: number,
	monthlyUnlimited: CurrentCloudBillingPlan,
): 'team' | 'unlimited' | null {
	const monthlyTeam = findPlan(availablePlans, 'team', 'monthly');
	if (!monthlyTeam) {
		return null;
	}
	const teamCost = monthlyTeam.unitAmount * Math.max(TEAM_MIN_SEATS, seatUserCount);
	return teamCost >= monthlyUnlimited.unitAmount ? 'unlimited' : 'team';
}

function findPlan(plans: CurrentCloudBillingPlan[], tier: 'team' | 'unlimited', interval: 'monthly' | 'yearly') {
	return plans.find((plan) => plan.tier === tier && plan.interval === interval);
}

function isPaidPlanSelected(billing: Billing): boolean {
	return Boolean(billing?.stripeSubscriptionId && billing.billingPlan);
}

function toBillingInterval(interval: 'month' | 'year'): 'monthly' | 'yearly' {
	return interval === 'month' ? 'monthly' : 'yearly';
}

function toLegacyCompatiblePlan(plan: CurrentCloudBillingPlan) {
	const definition = CLOUD_BILLING_PLANS[plan.planKey];
	return {
		key: plan.planKey,
		name: definition.name,
		amount: plan.unitAmount,
		currency: plan.currency,
		interval: definition.interval,
		intervalCount: definition.intervalCount,
		trialDays: definition.trialDays,
		userLimit: definition.userLimit,
		tier: definition.tier,
		perSeat: definition.perSeat,
	};
}
