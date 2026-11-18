import * as billingQueries from '../queries/billing.queries';
import * as organizationQueries from '../queries/organization.queries';
import * as userQueries from '../queries/user.queries';
import { reconcileCloudBillingCustomer } from './billing-reconciliation.service';
import { createCloudCustomer, createCloudTrialPlaceholderSubscription, listCloudSubscriptions } from './stripe.service';

export async function provisionCloudTrial(organizationId: string, actingUserId?: string): Promise<void> {
	const organization = await billingQueries.getOrganizationWithBilling(organizationId);
	if (!organization) {
		throw new Error(`Organization "${organizationId}" was not found`);
	}
	const billing = organization.billing;
	if (
		organization.bypassBilling ||
		billing?.billingStatus !== 'trialing' ||
		!billing.trialEndsAt ||
		billing.trialEndsAt.getTime() <= Date.now()
	) {
		return;
	}

	const stripeCustomerId = billing.stripeCustomerId ?? (await createAndAttachCustomer(organization, actingUserId));
	const subscriptions = await listCloudSubscriptions(stripeCustomerId);
	if (subscriptions.length === 0) {
		await createCloudTrialPlaceholderSubscription({
			organizationId,
			stripeCustomerId,
			trialEnd: billing.trialEndsAt,
		});
	}

	await reconcileCloudBillingCustomer({ stripeCustomerId, organizationIdHint: organizationId });
}

async function createAndAttachCustomer(
	organization: billingQueries.OrganizationWithBilling,
	actingUserId?: string,
): Promise<string> {
	const adminEmail = await getStripeCustomerAdminEmail(organization.id, actingUserId);
	if (!adminEmail) {
		throw new Error(`Organization "${organization.id}" has no admin email for Stripe Customer creation`);
	}
	const customer = await createCloudCustomer({
		organizationId: organization.id,
		organizationName: organization.name,
		adminEmail,
	});
	const billing = await billingQueries.attachStripeCustomer(organization.id, customer.id);
	if (!billing.stripeCustomerId) {
		throw new Error(`Unable to attach Stripe Customer "${customer.id}" to organization "${organization.id}"`);
	}
	return billing.stripeCustomerId;
}

async function getStripeCustomerAdminEmail(organizationId: string, actingUserId?: string): Promise<string | null> {
	if (actingUserId && (await organizationQueries.getUserRoleInOrg(organizationId, actingUserId)) === 'admin') {
		const actingAdmin = await userQueries.getUserProfile(actingUserId);
		const email = actingAdmin?.email.trim();
		if (email) {
			return email;
		}
	}
	return (await organizationQueries.getEarliestOrganizationAdmin(organizationId))?.email ?? null;
}
