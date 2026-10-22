import type Stripe from 'stripe';

import * as billingQueries from '../queries/billing.queries';
import { getCreditPurchaseByPaymentIntent } from '../queries/credit-wallet.queries';
import { settleCreditTopUpCheckout } from '../services/billing-management.service';
import { reconcileCloudBillingCustomer } from '../services/billing-reconciliation.service';
import { setCreditPurchaseMovement } from '../services/credit-wallet.service';
import type { JobHandler } from '../services/scheduler.service';
import {
	findCloudSubscription,
	findManagedCloudSubscription,
	getCloudCheckoutSubscription,
	getStripeCharge,
	getStripeCheckoutSession,
	getStripeDispute,
	getStripeEvent,
	getStripeInvoice,
	getStripePaymentMethod,
	isCreditTopUpCheckoutSession,
} from '../services/stripe.service';
import { isCloudBillingPlanKey } from '../types/billing';

export const STRIPE_WEBHOOK_PROCESS_JOB_NAME = 'stripe.webhook.process';

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

const DISPUTE_EVENTS = new Set([
	'charge.dispute.created',
	'charge.dispute.updated',
	'charge.dispute.closed',
	'charge.dispute.funds_withdrawn',
	'charge.dispute.funds_reinstated',
]);

const DISPUTE_STATUSES_WITHOUT_WITHDRAWN_FUNDS = new Set([
	'warning_needs_response',
	'warning_under_review',
	'warning_closed',
	'won',
	'prevented',
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
		if (isCreditTopUpCheckoutSession(eventSession)) {
			if (event.type === 'checkout.session.completed' && eventSession.payment_status !== 'paid') {
				return;
			}
			await settleCreditTopUpCheckout(eventSession.id);
		} else if (eventSession.mode === 'subscription' && isCloudBillingPlanKey(eventSession.metadata?.nao_plan_key)) {
			await processCheckoutSession(eventSession.id);
		}
		return;
	}
	if (event.type === 'charge.refunded') {
		await processRefundedCharge((event.data.object as Stripe.Charge).id);
		return;
	}
	if (DISPUTE_EVENTS.has(event.type)) {
		await processDispute((event.data.object as Stripe.Dispute).id);
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
		event.type !== 'charge.refunded' &&
		!DISPUTE_EVENTS.has(event.type) &&
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
		if (isCreditTopUpCheckoutSession(session)) {
			if (event.type === 'checkout.session.completed' && session.payment_status !== 'paid') {
				return;
			}
			await settleCreditTopUpCheckout(objectId);
		} else if (session.mode === 'subscription' && isCloudBillingPlanKey(session.metadata?.nao_plan_key)) {
			await processCheckoutSession(objectId);
		}
		return;
	}
	if (event.type === 'charge.refunded') {
		await processRefundedCharge(objectId);
		return;
	}
	if (DISPUTE_EVENTS.has(event.type)) {
		await processDispute(objectId);
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
	if (session.mode !== 'subscription' || !isCloudBillingPlanKey(session.metadata?.nao_plan_key)) {
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

async function processRefundedCharge(stripeChargeId: string): Promise<void> {
	const charge = await getStripeCharge(stripeChargeId);
	const paymentIntentId = optionalStripeId(charge.payment_intent);
	if (!paymentIntentId || charge.amount <= 0 || charge.amount_refunded <= 0) {
		return;
	}
	const purchase = await getCreditPurchaseByPaymentIntent(paymentIntentId);
	if (!purchase) {
		return;
	}
	const targetRefundMicroUsd = Math.min(
		purchase.entry.deltaMicroUsd,
		Math.floor((purchase.entry.deltaMicroUsd * charge.amount_refunded) / charge.amount),
	);
	await setCreditPurchaseMovement({
		paymentIntentId,
		movementGroupId: `refund:${charge.id}`,
		targetDeltaMicroUsd: -targetRefundMicroUsd,
		idempotencyKey: `refund:stripe:${charge.id}:${charge.amount_refunded}`,
		externalReference: charge.id,
		entryType: 'refund',
		metadata: {
			refundedAmountCents: charge.amount_refunded,
			paidAmountCents: charge.amount,
		},
	});
}

async function processDispute(stripeDisputeId: string): Promise<void> {
	const dispute = await getStripeDispute(stripeDisputeId);
	const charge = typeof dispute.charge === 'string' ? await getStripeCharge(dispute.charge) : dispute.charge;
	const paymentIntentId = optionalStripeId(charge.payment_intent);
	if (!paymentIntentId) {
		return;
	}
	const purchase = await getCreditPurchaseByPaymentIntent(paymentIntentId);
	if (!purchase) {
		return;
	}
	const fundsWithdrawn = !DISPUTE_STATUSES_WITHOUT_WITHDRAWN_FUNDS.has(dispute.status);
	if (fundsWithdrawn && (dispute.amount <= 0 || charge.amount <= 0)) {
		return;
	}
	const disputedCreditMicroUsd = fundsWithdrawn
		? Math.min(
				purchase.entry.deltaMicroUsd,
				Math.floor((purchase.entry.deltaMicroUsd * dispute.amount) / charge.amount),
			)
		: 0;
	await setCreditPurchaseMovement({
		paymentIntentId,
		movementGroupId: `dispute:${dispute.id}`,
		targetDeltaMicroUsd: fundsWithdrawn ? -disputedCreditMicroUsd : 0,
		idempotencyKey: `dispute:stripe:${dispute.id}:${dispute.status}`,
		externalReference: dispute.id,
		entryType: 'adjustment',
		metadata: {
			adjustmentType: fundsWithdrawn ? 'dispute_opened' : 'dispute_won',
			disputeStatus: dispute.status,
			disputedAmountCents: dispute.amount,
			paidAmountCents: charge.amount,
		},
	});
}

async function processSubscription(stripeSubscriptionId: string): Promise<void> {
	const subscription = await findManagedCloudSubscription(stripeSubscriptionId);
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

function optionalStripeId(value: string | { id: string } | null): string | null {
	return value ? (typeof value === 'string' ? value : value.id) : null;
}
