import type Stripe from 'stripe';

import * as billingQueries from '../queries/billing.queries';
import * as organizationQueries from '../queries/organization.queries';
import type { JobHandler } from '../services/scheduler.service';
import {
	cloudSubscriptionProjection,
	getCloudCheckoutSubscription,
	getCloudSubscription,
	getStripeEvent,
} from '../services/stripe.service';
import { STRIPE_WEBHOOK_JOB_NAME } from '../types/billing';

export { STRIPE_WEBHOOK_JOB_NAME };

const SUBSCRIPTION_EVENTS = new Set([
	'customer.subscription.created',
	'customer.subscription.updated',
	'customer.subscription.deleted',
	'customer.subscription.paused',
	'customer.subscription.resumed',
	'customer.subscription.trial_will_end',
]);

const INVOICE_EVENTS = new Set([
	'invoice.paid',
	'invoice.payment_failed',
	'invoice.payment_action_required',
	'invoice.finalization_failed',
]);

export const stripeWebhookHandler: JobHandler<{ eventId?: unknown }> = async (payload) => {
	if (typeof payload.eventId !== 'string') {
		throw new Error('Stripe webhook job is missing eventId');
	}

	const inboxEvent = await billingQueries.getStripeWebhookEvent(payload.eventId);
	if (!inboxEvent) {
		throw new Error(`Stripe webhook event "${payload.eventId}" was not found`);
	}
	if (inboxEvent.processedAt) {
		return;
	}

	try {
		await processStripeEvent(await getStripeEvent(payload.eventId));
		await billingQueries.markStripeWebhookEventProcessed(payload.eventId);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await billingQueries.markStripeWebhookEventFailed(payload.eventId, message);
		throw error;
	}
};

async function processStripeEvent(event: Stripe.Event): Promise<void> {
	if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
		const eventSession = event.data.object as Stripe.Checkout.Session;
		const { session, subscription } = await getCloudCheckoutSubscription(eventSession.id);
		const organizationId = session.metadata?.nao_org_id ?? session.client_reference_id;
		if (!organizationId) {
			throw new Error(`Stripe Checkout Session "${session.id}" has no organization metadata`);
		}
		if (stripeId(session.customer) !== stripeId(subscription.customer)) {
			throw new Error(`Stripe Checkout Session "${session.id}" has an unexpected Customer`);
		}
		await reconcileSubscription(subscription, organizationId);
		return;
	}

	if (SUBSCRIPTION_EVENTS.has(event.type)) {
		const eventSubscription = event.data.object as Stripe.Subscription;
		await reconcileSubscription(
			await getCloudSubscription(eventSubscription.id),
			eventSubscription.metadata.nao_org_id,
		);
		return;
	}

	if (INVOICE_EVENTS.has(event.type)) {
		const invoice = event.data.object as Stripe.Invoice;
		const subscriptionId = invoice.parent?.subscription_details?.subscription;
		if (!subscriptionId) {
			return;
		}
		await reconcileSubscription(
			await getCloudSubscription(stripeId(subscriptionId)),
			invoice.parent?.subscription_details?.metadata?.nao_org_id,
		);
	}
}

async function reconcileSubscription(subscription: Stripe.Subscription, organizationId?: string): Promise<void> {
	const customerId = stripeId(subscription.customer);
	let organization =
		(await billingQueries.getOrganizationByStripeSubscriptionId(subscription.id)) ??
		(await billingQueries.getOrganizationByStripeCustomerId(customerId));

	const metadataOrganizationId = subscription.metadata.nao_org_id;
	const expectedOrganizationId = organizationId ?? metadataOrganizationId;
	if (organization && expectedOrganizationId && organization.id !== expectedOrganizationId) {
		throw new Error(`Stripe Subscription "${subscription.id}" organization metadata does not match`);
	}
	if (!organization && expectedOrganizationId) {
		const metadataOrganization = await organizationQueries.getOrganizationById(expectedOrganizationId);
		if (!metadataOrganization) {
			throw new Error(`Organization "${expectedOrganizationId}" was not found`);
		}
		organization = await billingQueries.attachStripeCustomer(metadataOrganization.id, customerId);
	}
	if (!organization) {
		throw new Error(`No organization is attached to Stripe Customer "${customerId}"`);
	}
	if (organization.stripeCustomerId !== customerId) {
		throw new Error(`Stripe Subscription "${subscription.id}" has an unexpected Customer`);
	}

	await billingQueries.updateSubscriptionProjection(organization.id, await cloudSubscriptionProjection(subscription));
}

function stripeId(value: string | { id: string } | null): string {
	if (!value) {
		throw new Error('Stripe object reference is missing');
	}
	return typeof value === 'string' ? value : value.id;
}
