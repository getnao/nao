import type Stripe from 'stripe';

import * as billingQueries from '../queries/billing.queries';
import { sendCloudTrialReminder } from '../services/billing-lifecycle.service';
import { reconcileCloudBillingCustomer } from '../services/billing-reconciliation.service';
import type { JobHandler } from '../services/scheduler.service';
import { getCloudCheckoutSubscription, getCloudSubscription, getStripeEvent } from '../services/stripe.service';
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

const PAYMENT_METHOD_EVENTS = new Set([
	'customer.updated',
	'payment_method.attached',
	'payment_method.detached',
	'payment_method.updated',
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
		await reconcileCloudBillingCustomer({
			stripeCustomerId: stripeId(session.customer),
			organizationIdHint: organizationId,
		});
		return;
	}

	if (SUBSCRIPTION_EVENTS.has(event.type)) {
		const eventSubscription = event.data.object as Stripe.Subscription;
		const customerId = stripeId(eventSubscription.customer);
		const result = await reconcileCloudBillingCustomer({
			stripeCustomerId: customerId,
			organizationIdHint: eventSubscription.metadata.nao_org_id,
		});
		if (event.type === 'customer.subscription.trial_will_end' && !result.ignored) {
			const organization = await billingQueries.getOrganizationByStripeCustomerId(customerId);
			if (organization) {
				await sendCloudTrialReminder(organization.id);
			}
		}
		return;
	}

	if (INVOICE_EVENTS.has(event.type)) {
		const invoice = event.data.object as Stripe.Invoice;
		const customerId = await invoiceCustomerId(invoice);
		if (!customerId) {
			return;
		}
		await reconcileCloudBillingCustomer({
			stripeCustomerId: customerId,
			organizationIdHint: invoice.parent?.subscription_details?.metadata?.nao_org_id,
		});
		return;
	}

	if (PAYMENT_METHOD_EVENTS.has(event.type)) {
		const customerId = paymentMethodCustomerId(event);
		if (customerId) {
			await reconcileCloudBillingCustomer({ stripeCustomerId: customerId });
		}
	}
}

async function invoiceCustomerId(invoice: Stripe.Invoice): Promise<string | null> {
	if (invoice.customer) {
		return stripeId(invoice.customer);
	}
	const subscriptionId = invoice.parent?.subscription_details?.subscription;
	if (!subscriptionId) {
		return null;
	}
	return stripeId((await getCloudSubscription(stripeId(subscriptionId))).customer);
}

function paymentMethodCustomerId(event: Stripe.Event): string | null {
	if (event.type === 'customer.updated') {
		return (event.data.object as Stripe.Customer).id;
	}

	const paymentMethod = event.data.object as Stripe.PaymentMethod;
	const previous = event.data.previous_attributes as { customer?: string | Stripe.Customer | null } | undefined;
	const customer = paymentMethod.customer ?? previous?.customer;
	return customer ? stripeId(customer) : null;
}

function stripeId(value: string | { id: string } | null): string {
	if (!value) {
		throw new Error('Stripe object reference is missing');
	}
	return typeof value === 'string' ? value : value.id;
}
