import type { DBOrganization, DBOrganizationBilling } from '../db/abstractSchema';
import * as billingQueries from '../queries/billing.queries';
import * as organizationQueries from '../queries/organization.queries';
import * as userQueries from '../queries/user.queries';
import { CLOUD_MONTHLY_PLAN, isTerminalBillingStatus } from '../types/billing';
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

type CloudBillingOrganization = DBOrganization & Omit<DBOrganizationBilling, 'orgId'>;

export class CloudBillingManagementInputError extends HandlerError {
	constructor(message: string) {
		super('BAD_REQUEST', message);
		this.name = 'CloudBillingManagementInputError';
	}
}

export async function getCloudBillingOrganizationForAdmin(input: AdminBillingInput): Promise<CloudBillingOrganization> {
	return requireAdminOrganization(input);
}

export async function createCloudTrialCheckoutForAdmin(input: AdminBillingInput): Promise<string> {
	const organization = await requireAdminOrganization(input);
	if (
		organization.billingStatus ||
		organization.trialStartedAt ||
		organization.trialEndsAt ||
		organization.stripeSubscriptionId
	) {
		throw new CloudBillingManagementInputError('This organization has already used its free trial');
	}
	const stripeCustomerId = await ensureCloudCustomer(organization, input.userId);
	return createCloudCheckoutSession({
		organizationId: organization.id,
		stripeCustomerId,
		trialDays: CLOUD_MONTHLY_PLAN.trialDays,
	});
}

export async function listCloudInvoicesForAdmin(input: AdminBillingInput) {
	const organization = await requireAdminOrganization(input);
	return organization.stripeCustomerId ? listCloudInvoices(organization.stripeCustomerId) : [];
}

export async function getCloudUpcomingInvoiceForAdmin(input: AdminBillingInput) {
	const organization = await requireAdminOrganization(input);
	return organization.stripeSubscriptionId ? getCloudUpcomingInvoice(organization.stripeSubscriptionId) : null;
}

export async function syncCloudBillingForAdmin(input: AdminBillingInput): Promise<{ synced: boolean }> {
	const organization = await requireAdminOrganization(input);
	if (!organization.stripeCustomerId) {
		return { synced: false };
	}
	await reconcileCloudBillingCustomer({
		stripeCustomerId: organization.stripeCustomerId,
		organizationIdHint: organization.id,
	});
	return { synced: true };
}

export async function createCloudPortalForAdmin(input: AdminBillingRequestInput): Promise<string> {
	const organization = await requireAdminOrganization(input);
	if (!organization.stripeCustomerId || !organization.stripeSubscriptionId) {
		throw new CloudBillingManagementInputError('No Stripe subscription is available to manage');
	}
	return createCloudPortalSession({
		organizationId: organization.id,
		stripeCustomerId: organization.stripeCustomerId,
		requestId: input.requestId,
	});
}

export async function createCloudPaymentMethodPortalForAdmin(input: AdminBillingRequestInput): Promise<string> {
	const organization = await requireAdminOrganization(input);
	if (!organization.stripeCustomerId) {
		throw new CloudBillingManagementInputError('No Stripe Customer is available to manage');
	}
	return createCloudPaymentMethodSession({
		organizationId: organization.id,
		stripeCustomerId: organization.stripeCustomerId,
		requestId: input.requestId,
	});
}

export async function createCloudResubscribeForAdmin(input: AdminBillingInput): Promise<string> {
	const organization = await requireAdminOrganization(input);
	const isMissingSubscriptionRecovery =
		!organization.stripeSubscriptionId &&
		Boolean(organization.billingStatus || organization.trialStartedAt || organization.trialEndsAt);
	if (
		organization.stripeSubscriptionId
			? !organization.stripeCustomerId || !isTerminalBillingStatus(organization.billingStatus)
			: !isMissingSubscriptionRecovery
	) {
		throw new CloudBillingManagementInputError('A new subscription is not available');
	}
	const stripeCustomerId = await ensureCloudCustomer(organization, input.userId);
	return createCloudResubscribeSession({
		organizationId: organization.id,
		stripeCustomerId,
		allowMissingHistory: isMissingSubscriptionRecovery,
	});
}

export async function resumeCloudSubscriptionForAdmin(input: AdminBillingRequestInput): Promise<void> {
	const organization = await requireAdminOrganization(input);
	if (!organization.stripeSubscriptionId) {
		throw new CloudBillingManagementInputError('No Stripe subscription is available to resume');
	}
	await resumeCloudSubscription({
		organizationId: organization.id,
		stripeSubscriptionId: organization.stripeSubscriptionId,
		requestId: input.requestId,
	});
}

async function requireAdminOrganization(input: AdminBillingInput): Promise<CloudBillingOrganization> {
	const membership = await organizationQueries.getOrgMember(input.organizationId, input.userId);
	if (membership?.role !== 'admin') {
		throw new HandlerError('FORBIDDEN', 'Only organization admins can manage billing');
	}

	const organization = await organizationQueries.getOrganizationById(input.organizationId);
	if (!organization) {
		throw new HandlerError('NOT_FOUND', 'Organization was not found');
	}
	const billing = await billingQueries.getOrganizationBilling(input.organizationId);
	return {
		...organization,
		billingPlan: billing?.billingPlan ?? null,
		billingStatus: billing?.billingStatus ?? null,
		trialStartedAt: billing?.trialStartedAt ?? null,
		trialEndsAt: billing?.trialEndsAt ?? null,
		stripeCustomerId: billing?.stripeCustomerId ?? null,
		stripeSubscriptionId: billing?.stripeSubscriptionId ?? null,
		stripePriceId: billing?.stripePriceId ?? null,
		currentPeriodStartsAt: billing?.currentPeriodStartsAt ?? null,
		currentPeriodEndsAt: billing?.currentPeriodEndsAt ?? null,
		cancellationScheduled: billing?.cancellationScheduled ?? null,
		hasDefaultPaymentMethod: billing?.hasDefaultPaymentMethod ?? null,
		billingAccessEndsAt: billing?.billingAccessEndsAt ?? null,
		billingUpdatedAt: billing?.billingUpdatedAt ?? null,
		billingSyncToken: billing?.billingSyncToken ?? null,
	};
}

async function ensureCloudCustomer(organization: CloudBillingOrganization, userId: string): Promise<string> {
	if (organization.stripeCustomerId) {
		return organization.stripeCustomerId;
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
