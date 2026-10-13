import type { OrganizationWithBilling } from '../queries/billing.queries';
import * as billingQueries from '../queries/billing.queries';
import * as userQueries from '../queries/user.queries';
import {
	CLOUD_BILLING_PLANS,
	type CloudBillingCurrency,
	type CloudBillingInterval,
	isTerminalBillingStatus,
	isTrialAvailable,
} from '../types/billing';
import { HandlerError } from '../utils/error';
import { reconcileCloudBillingCustomer } from './billing-reconciliation.service';
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

interface AdminBillingInput {
	userId: string;
	organizationId: string;
}

interface AdminBillingRequestInput extends AdminBillingInput {
	requestId: string;
}

interface AdminBillingCheckoutInput extends AdminBillingInput {
	billingInterval: CloudBillingInterval;
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
	const organization = await loadCloudBillingOrganization(input.organizationId);
	if (!isTrialAvailable(organization.billing)) {
		throw new CloudBillingManagementInputError('This organization has already used its free trial');
	}
	const stripeCustomerId = await ensureCloudCustomer(organization, input.userId);
	return createCloudCheckoutSession({
		billingInterval: input.billingInterval,
		currency: input.currency,
		organizationId: organization.id,
		stripeCustomerId,
		trialDays: CLOUD_BILLING_PLANS[input.billingInterval].trialDays,
	});
}

export async function listCloudInvoicesForAdmin(input: AdminBillingInput) {
	const organization = await loadCloudBillingOrganization(input.organizationId);
	return organization.billing?.stripeCustomerId ? listCloudInvoices(organization.billing.stripeCustomerId) : [];
}

export async function getCloudUpcomingInvoiceForAdmin(input: AdminBillingInput) {
	const organization = await loadCloudBillingOrganization(input.organizationId);
	return organization.billing?.stripeSubscriptionId
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
	if (!organization.billing?.stripeCustomerId || !organization.billing.stripeSubscriptionId) {
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
	if (!organization.billing?.stripeCustomerId) {
		throw new CloudBillingManagementInputError('No Stripe Customer is available to manage');
	}
	return createCloudPaymentMethodSession({
		organizationId: organization.id,
		stripeCustomerId: organization.billing.stripeCustomerId,
		requestId: input.requestId,
	});
}

export async function createCloudResubscribeForAdmin(input: AdminBillingCheckoutInput): Promise<string> {
	const organization = await loadCloudBillingOrganization(input.organizationId);
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
	const stripeCustomerId = await ensureCloudCustomer(organization, input.userId);
	return createCloudResubscribeSession({
		billingInterval: input.billingInterval,
		currency: input.currency,
		organizationId: organization.id,
		stripeCustomerId,
		allowMissingHistory: isMissingSubscriptionRecovery,
	});
}

export async function resumeCloudSubscriptionForAdmin(input: AdminBillingRequestInput): Promise<void> {
	const organization = await loadCloudBillingOrganization(input.organizationId);
	if (!organization.billing?.stripeSubscriptionId) {
		throw new CloudBillingManagementInputError('No Stripe subscription is available to resume');
	}
	await resumeCloudSubscription({
		organizationId: organization.id,
		stripeSubscriptionId: organization.billing.stripeSubscriptionId,
		requestId: input.requestId,
	});
}

async function loadCloudBillingOrganization(organizationId: string): Promise<OrganizationWithBilling> {
	const organization = await billingQueries.getOrganizationWithBilling(organizationId);
	if (!organization) {
		throw new HandlerError('NOT_FOUND', 'Organization was not found');
	}
	return organization;
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
