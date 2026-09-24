import type Stripe from 'stripe';

import * as billingQueries from '../queries/billing.queries';
import * as organizationQueries from '../queries/organization.queries';
import { cloudSubscriptionProjection, hasCloudDefaultPaymentMethod, listCloudSubscriptions } from './stripe.service';

interface CloudBillingReconciliationResult {
	applied: boolean;
	ignored: boolean;
}

export async function reconcileCloudBillingCustomer(input: {
	stripeCustomerId: string;
	organizationIdHint?: string;
}): Promise<CloudBillingReconciliationResult> {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const result = await reconcileCloudBillingCustomerOnce(input);
		if (result.applied || result.ignored) {
			return result;
		}
	}
	throw new Error(`Stripe Customer "${input.stripeCustomerId}" reconciliation was repeatedly superseded`);
}

async function reconcileCloudBillingCustomerOnce(input: {
	stripeCustomerId: string;
	organizationIdHint?: string;
}): Promise<CloudBillingReconciliationResult> {
	const organization = await resolveOrganization(input.stripeCustomerId, input.organizationIdHint);
	if (!organization) {
		return { applied: false, ignored: true };
	}
	const claim = await billingQueries.claimBillingSync(organization.id, input.stripeCustomerId);
	const subscriptions = await listCloudSubscriptions(input.stripeCustomerId);
	const subscription = selectCloudSubscription(subscriptions);

	if (!subscription) {
		return {
			applied: await billingQueries.updatePaymentMethodProjection(
				organization.id,
				claim.token,
				input.stripeCustomerId,
				await hasCloudDefaultPaymentMethod(input.stripeCustomerId),
			),
			ignored: false,
		};
	}

	assertSubscriptionOwnership(subscription, input.stripeCustomerId, organization.id);
	const projection = await cloudSubscriptionProjection(subscription);
	return {
		applied: await billingQueries.updateSubscriptionProjection(organization.id, claim.token, {
			...projection,
			trialStartedAt: projection.trialStartedAt ?? claim.organization.trialStartedAt,
			trialEndsAt: projection.trialEndsAt ?? claim.organization.trialEndsAt,
		}),
		ignored: false,
	};
}

async function resolveOrganization(stripeCustomerId: string, organizationIdHint?: string) {
	const attached = await billingQueries.getOrganizationByStripeCustomerId(stripeCustomerId);
	if (attached) {
		return attached;
	}

	const subscriptions = await listCloudSubscriptions(stripeCustomerId);
	const liveOrganizationId = selectCloudSubscription(subscriptions)?.metadata.nao_org_id;
	const organizationId = liveOrganizationId ?? organizationIdHint;
	if (!organizationId) {
		return null;
	}

	const organization = await organizationQueries.getOrganizationById(organizationId);
	if (!organization) {
		throw new Error(`Organization "${organizationId}" was not found`);
	}
	return billingQueries.attachStripeCustomer(organization.id, stripeCustomerId);
}

function selectCloudSubscription(subscriptions: Stripe.Subscription[]): Stripe.Subscription | null {
	const current = subscriptions.filter((subscription) => !isTerminalSubscription(subscription));
	if (current.length > 1) {
		throw new Error('Stripe Customer has multiple current cloud subscriptions');
	}
	if (current[0]) {
		return current[0];
	}

	return [...subscriptions].sort((left, right) => right.created - left.created)[0] ?? null;
}

function assertSubscriptionOwnership(
	subscription: Stripe.Subscription,
	stripeCustomerId: string,
	organizationId: string,
): void {
	const subscriptionCustomerId =
		typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
	if (subscriptionCustomerId !== stripeCustomerId) {
		throw new Error(`Stripe Subscription "${subscription.id}" has an unexpected Customer`);
	}
	const metadataOrganizationId = subscription.metadata.nao_org_id;
	if (metadataOrganizationId && metadataOrganizationId !== organizationId) {
		throw new Error(`Stripe Subscription "${subscription.id}" organization metadata does not match`);
	}
}

function isTerminalSubscription(subscription: Stripe.Subscription): boolean {
	return subscription.status === 'canceled' || subscription.status === 'incomplete_expired';
}
