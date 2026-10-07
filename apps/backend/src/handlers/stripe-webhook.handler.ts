import type Stripe from 'stripe';

import * as billingQueries from '../queries/billing.queries';
import { reconcileCloudBillingCustomer } from '../services/billing-reconciliation.service';
import type { JobHandler } from '../services/scheduler.service';
import {
	findCloudSubscription,
	getCloudCheckoutSubscription,
	getStripeCheckoutSession,
	getStripeEvent,
	getStripeInvoice,
	getStripePaymentMethod,
} from '../services/stripe.service';
import { CLOUD_MONTHLY_PLAN, STRIPE_WEBHOOK_PROCESS_JOB_NAME } from '../types/billing';

export { STRIPE_WEBHOOK_PROCESS_JOB_NAME };

const SUBSCRIPTION_EVENTS = new Set([
	'customer.subscription.created',
	'customer.subscription.updated',
	'customer.subscription.deleted',
	'customer.subscription.paused',
	'customer.subscription.resumed',
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

export const stripeWebhookProcessHandler: JobHandler<{ eventId?: unknown }> = async (payload) => {
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
		let stripeEvent: Stripe.Event | null = null;
		try {
			stripeEvent = await getStripeEvent(payload.eventId);
		} catch (error) {
			if (!isMissingStripeEvent(error)) {
				throw error;
			}
		}
		if (stripeEvent) {
			await processStripeEvent(stripeEvent);
		} else {
			await processStoredStripeEvent(inboxEvent);
		}
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
		if (eventSession.mode !== 'subscription' || eventSession.metadata?.nao_plan_key !== CLOUD_MONTHLY_PLAN.key) {
			return;
		}
		await processCheckoutSession(eventSession.id);
		return;
	}

	if (SUBSCRIPTION_EVENTS.has(event.type)) {
		const eventSubscription = event.data.object as Stripe.Subscription;
		await processSubscription(eventSubscription.id);
		return;
	}

	if (INVOICE_EVENTS.has(event.type)) {
		await processInvoice(event.data.object as Stripe.Invoice);
		return;
	}

	if (PAYMENT_METHOD_EVENTS.has(event.type)) {
		await processPaymentMethodEvent(
			event.type,
			event.data.object as Stripe.Customer | Stripe.PaymentMethod,
			event.data.previous_attributes as { customer?: string | Stripe.Customer | null } | undefined,
		);
	}
}

async function processStoredStripeEvent(event: { type: string; stripeObjectId: string | null }): Promise<void> {
	const checkoutEvent =
		event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded';
	if (
		!checkoutEvent &&
		!SUBSCRIPTION_EVENTS.has(event.type) &&
		!INVOICE_EVENTS.has(event.type) &&
		!PAYMENT_METHOD_EVENTS.has(event.type)
	) {
		return;
	}
	const objectId = event.stripeObjectId;
	if (!objectId) {
		throw new Error(`Stored Stripe event "${event.type}" has no object ID`);
	}

	if (checkoutEvent) {
		const session = await getStripeCheckoutSession(objectId);
		if (session.mode !== 'subscription' || session.metadata?.nao_plan_key !== CLOUD_MONTHLY_PLAN.key) {
			return;
		}
		await processCheckoutSession(objectId);
		return;
	}
	if (SUBSCRIPTION_EVENTS.has(event.type)) {
		await processSubscription(objectId);
		return;
	}
	if (INVOICE_EVENTS.has(event.type)) {
		await processInvoice(await getStripeInvoice(objectId));
		return;
	}
	if (event.type === 'customer.updated') {
		await reconcileCloudBillingCustomer({ stripeCustomerId: objectId });
		return;
	}
	if (event.type === 'payment_method.detached') {
		await reconcileAllMappedCustomers();
		return;
	}
	if (event.type === 'payment_method.attached' || event.type === 'payment_method.updated') {
		await processPaymentMethodEvent(event.type, await getStripePaymentMethod(objectId));
	}
}

async function processCheckoutSession(stripeCheckoutSessionId: string): Promise<void> {
	const { session, subscription } = await getCloudCheckoutSubscription(stripeCheckoutSessionId);
	if (session.mode !== 'subscription' || session.metadata?.nao_plan_key !== CLOUD_MONTHLY_PLAN.key) {
		return;
	}
	const organizationId = session.metadata.nao_org_id ?? session.client_reference_id;
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
}

async function processSubscription(stripeSubscriptionId: string): Promise<void> {
	const subscription = await findCloudSubscription(stripeSubscriptionId);
	if (!subscription) {
		return;
	}
	await reconcileCloudBillingCustomer({
		stripeCustomerId: stripeId(subscription.customer),
		organizationIdHint: subscription.metadata.nao_org_id,
	});
}

async function processInvoice(invoice: Stripe.Invoice): Promise<void> {
	const subscriptionId = invoice.parent?.subscription_details?.subscription;
	if (!subscriptionId) {
		return;
	}
	const subscription = await findCloudSubscription(stripeId(subscriptionId));
	if (!subscription) {
		return;
	}
	const customerId = stripeId(subscription.customer);
	if (invoice.customer && stripeId(invoice.customer) !== customerId) {
		throw new Error(`Stripe Invoice "${invoice.id}" has an unexpected Customer`);
	}
	await reconcileCloudBillingCustomer({
		stripeCustomerId: customerId,
		organizationIdHint: subscription.metadata.nao_org_id,
	});
}

async function processPaymentMethodEvent(
	eventType: string,
	stripeObject: Stripe.Customer | Stripe.PaymentMethod,
	previousAttributes?: { customer?: string | Stripe.Customer | null },
): Promise<void> {
	if (eventType === 'customer.updated') {
		await reconcileCloudBillingCustomer({ stripeCustomerId: stripeObject.id });
		return;
	}

	const customer = (stripeObject as Stripe.PaymentMethod).customer ?? previousAttributes?.customer;
	if (customer) {
		await reconcileCloudBillingCustomer({ stripeCustomerId: stripeId(customer) });
		return;
	}
	await reconcileAllMappedCustomers();
}

async function reconcileAllMappedCustomers(): Promise<void> {
	// ponytail: Stripe can omit the former Customer on detach; replace this scan with persisted ownership if it grows.
	const billings = await billingQueries.listOrganizationBillingsWithStripeCustomers();
	const failures: string[] = [];
	for (const billing of billings) {
		if (!billing.stripeCustomerId) {
			continue;
		}
		try {
			await reconcileCloudBillingCustomer({
				stripeCustomerId: billing.stripeCustomerId,
				organizationIdHint: billing.orgId,
			});
		} catch (error) {
			failures.push(`${billing.orgId}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (failures.length > 0) {
		throw new Error(`Reconciliation failed for ${failures.length} organization(s): ${failures.join('; ')}`);
	}
}

function isMissingStripeEvent(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'statusCode' in error &&
		(error as { statusCode?: unknown }).statusCode === 404
	);
}

function stripeId(value: string | { id: string } | null): string {
	if (!value) {
		throw new Error('Stripe object reference is missing');
	}
	return typeof value === 'string' ? value : value.id;
}
