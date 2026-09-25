import type { DBOrganization } from '../db/abstractSchema';
import * as billingQueries from '../queries/billing.queries';
import * as organizationQueries from '../queries/organization.queries';
import * as userQueries from '../queries/user.queries';
import { CLOUD_MONTHLY_PLAN } from '../types/billing';
import { HandlerError } from '../utils/error';
import { reconcileCloudBillingCustomer } from './billing-reconciliation.service';
import {
	CloudInitialCheckoutUnavailableError,
	createCloudCheckoutSession,
	createCloudCustomer,
	createCloudPaymentMethodSession,
	createCloudPortalSession,
	createCloudResubscribeSession,
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

export class CloudBillingManagementInputError extends HandlerError {
	constructor(message: string) {
		super('BAD_REQUEST', message);
		this.name = 'CloudBillingManagementInputError';
	}
}

export async function getCloudBillingOrganizationForAdmin(input: AdminBillingInput): Promise<DBOrganization> {
	return requireAdminOrganization(input);
}

export async function startCloudTrialForAdmin(input: AdminBillingInput): Promise<string> {
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
		trialEndsAt: null,
		trialDays: CLOUD_MONTHLY_PLAN.trialDays,
	});
}

export async function listCloudInvoicesForAdmin(input: AdminBillingInput) {
	const organization = await requireAdminOrganization(input);
	return organization.stripeCustomerId ? listCloudInvoices(organization.stripeCustomerId) : [];
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

export async function createCloudCheckoutForAdmin(input: AdminBillingInput): Promise<string> {
	const organization = await requireAdminOrganization(input);
	if (organization.stripeSubscriptionId) {
		throw new CloudInitialCheckoutUnavailableError('This organization already has a Stripe subscription');
	}
	if (!organization.trialStartedAt) {
		throw new CloudBillingManagementInputError('Start the organization trial before subscribing');
	}

	const stripeCustomerId = await ensureCloudCustomer(organization, input.userId);
	return createCloudCheckoutSession({
		organizationId: organization.id,
		stripeCustomerId,
		trialEndsAt: organization.trialEndsAt,
	});
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
	if (
		!organization.stripeCustomerId ||
		!organization.stripeSubscriptionId ||
		!['canceled', 'incomplete_expired'].includes(organization.billingStatus ?? '')
	) {
		throw new CloudBillingManagementInputError('A new subscription is not available');
	}
	return createCloudResubscribeSession({
		organizationId: organization.id,
		stripeCustomerId: organization.stripeCustomerId,
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

async function requireAdminOrganization(input: AdminBillingInput): Promise<DBOrganization> {
	const membership = await organizationQueries.getOrgMember(input.organizationId, input.userId);
	if (membership?.role !== 'admin') {
		throw new HandlerError('FORBIDDEN', 'Only organization admins can manage billing');
	}

	const organization = await organizationQueries.getOrganizationById(input.organizationId);
	if (!organization) {
		throw new HandlerError('NOT_FOUND', 'Organization was not found');
	}
	return organization;
}

async function ensureCloudCustomer(organization: DBOrganization, userId: string): Promise<string> {
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
