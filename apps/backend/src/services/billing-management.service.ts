import { isCloudFreeTierEnabled } from '../env';
import type { OrganizationWithBilling } from '../queries/billing.queries';
import * as billingQueries from '../queries/billing.queries';
import { getCreditPurchaseByCheckoutSession } from '../queries/credit-wallet.queries';
import * as organizationQueries from '../queries/organization.queries';
import * as userQueries from '../queries/user.queries';
import {
	CLOUD_BILLING_PLANS,
	type CloudBillingCurrency,
	type CloudBillingInterval,
	type CloudBillingPlanKey,
	isTerminalBillingStatus,
	isTrialAvailable,
	TEAM_MAX_SEATS,
	TEAM_MIN_SEATS,
} from '../types/billing';
import { HandlerError } from '../utils/error';
import { logger, serializeError } from '../utils/logger';
import {
	reconcileCloudBillingCustomer,
	reconcileCloudBillingCustomerUnderLock,
} from './billing-reconciliation.service';
import { isActiveTrialWithoutPaidPlan } from './cloud-billing-access.service';
import { createCreditTopUpCheckoutSession, getCreditTopUpPurchase } from './credit-top-up.service';
import { issueCreditPurchase } from './credit-wallet.service';
import { withOrganizationSeatLock } from './organization-seat.service';
import {
	createCloudCheckoutSession,
	createCloudCustomer,
	createCloudPaymentMethodSession,
	createCloudPortalSession,
	createCloudResubscribeSession,
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
	billingInterval?: CloudBillingInterval;
	planKey?: CloudBillingPlanKey;
	seatQuantity?: number;
	currency: CloudBillingCurrency;
}

export class CloudBillingManagementInputError extends HandlerError {
	constructor(message: string) {
		super('BAD_REQUEST', message);
		this.name = 'CloudBillingManagementInputError';
	}
}

export async function getCloudBillingOrganizationForAdmin(input: AdminBillingInput): Promise<OrganizationWithBilling> {
	return loadCloudBillingOrganization(input.organizationId);
}

export async function createCloudTrialCheckoutForAdmin(input: AdminBillingCheckoutInput): Promise<string> {
	return withOrganizationSeatLock(input.organizationId, async () => {
		await requireOrganizationAdmin(input);
		const plan = resolveCheckoutPlan(input);
		const organization = await loadReconciledCloudBillingOrganization(input.organizationId);
		const trialEndsAt = organization.billing?.trialEndsAt;
		if (!isActiveTrialWithoutPaidPlan(organization.billing) || !trialEndsAt) {
			if (isTrialAvailable(organization.billing)) {
				throw new CloudBillingManagementInputError(
					'Finish setting up your first project before choosing a billing plan',
				);
			}
			throw new CloudBillingManagementInputError('This organization has already used its free trial');
		}
		const stripeCustomerId = await ensureCloudCustomer(organization, input.userId);
		return createCloudCheckoutSession({
			...plan,
			currency: input.currency,
			organizationId: organization.id,
			stripeCustomerId,
			trialEnd: trialEndsAt,
		});
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
	return withOrganizationSeatLock(input.organizationId, async () => {
		await requireOrganizationAdmin(input);
		const plan = resolveCheckoutPlan(input);
		const organization = await loadReconciledCloudBillingOrganization(input.organizationId);
		const billing = organization.billing;
		if (!isResubscribeAvailable(billing)) {
			throw new CloudBillingManagementInputError('A new subscription is not available');
		}
		const stripeCustomerId = await ensureCloudCustomer(organization, input.userId);
		return createCloudResubscribeSession({
			...plan,
			currency: input.currency,
			organizationId: organization.id,
			stripeCustomerId,
			allowMissingHistory: !billing?.stripeSubscriptionId,
		});
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

export async function requireOrganizationAdmin(input: AdminBillingInput): Promise<void> {
	const member = await organizationQueries.getOrgMember(input.organizationId, input.userId);
	if (member?.role !== 'admin') {
		throw new HandlerError('FORBIDDEN', 'Only organization admins can manage billing');
	}
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
	await reconcileCloudBillingCustomerUnderLock({
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

function resolveCheckoutPlan(
	input: Pick<AdminBillingCheckoutInput, 'billingInterval' | 'planKey' | 'seatQuantity'>,
): { planKey: CloudBillingPlanKey; quantity: number } | { billingInterval?: CloudBillingInterval } {
	if (!isCloudFreeTierEnabled()) {
		return { billingInterval: input.billingInterval };
	}
	if (!input.planKey) {
		throw new CloudBillingManagementInputError('A billing plan is required');
	}
	if (CLOUD_BILLING_PLANS[input.planKey].tier === 'team') {
		return { planKey: input.planKey, quantity: validateTeamQuantity(input.seatQuantity) };
	}
	if (input.seatQuantity !== undefined) {
		throw new CloudBillingManagementInputError('Seat quantity is only available for Team');
	}
	return { planKey: input.planKey, quantity: 1 };
}

/** Recovers a lost subscription, replaces a terminal one, or (with the free tier) starts paid without a trial. */
function isResubscribeAvailable(billing: OrganizationWithBilling['billing']): boolean {
	if (billing?.stripeSubscriptionId) {
		return Boolean(billing.stripeCustomerId) && isTerminalBillingStatus(billing.billingStatus);
	}
	const isMissingSubscriptionRecovery = Boolean(
		billing?.billingStatus || billing?.trialStartedAt || billing?.trialEndsAt,
	);
	return isMissingSubscriptionRecovery || (isCloudFreeTierEnabled() && isTrialAvailable(billing));
}

export function validateTeamQuantity(quantity: number | undefined): number {
	if (
		!Number.isInteger(quantity) ||
		quantity === undefined ||
		quantity < TEAM_MIN_SEATS ||
		quantity > TEAM_MAX_SEATS
	) {
		throw new CloudBillingManagementInputError(
			`Team requires between ${TEAM_MIN_SEATS} and ${TEAM_MAX_SEATS} seats`,
		);
	}
	return quantity;
}
