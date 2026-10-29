import type Stripe from 'stripe';

import * as billingQueries from '../queries/billing.queries';
import { getCreditPurchaseByPaymentIntent } from '../queries/credit-wallet.queries';
import { settleCreditTopUpCheckout } from '../services/billing-management.service';
import { reconcileCloudBillingCustomer } from '../services/billing-reconciliation.service';
import { isCreditTopUpCheckoutSession, isCreditTopUpPaymentIntent } from '../services/credit-top-up.service';
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
	getStripePaymentIntent,
	getStripePaymentMethod,
} from '../services/stripe.service';
import { isCloudBillingPlanKey } from '../types/billing';
import { stripeId } from '../utils/stripe';

export const STRIPE_WEBHOOK_PROCESS_JOB_NAME = 'stripe.webhook.process';

const DISPUTE_STATUSES_WITHOUT_WITHDRAWN_FUNDS = new Set([
	'warning_needs_response',
	'warning_under_review',
	'warning_closed',
	'won',
	'prevented',
]);

interface ProcessableStripeEvent {
	type: string;
	objectId: string;
	stripeObject?: Stripe.Event['data']['object'];
	previousAttributes?: Stripe.Event['data']['previous_attributes'];
}

type StripeEventHandler = (event: ProcessableStripeEvent) => Promise<void>;

const STRIPE_EVENT_HANDLERS: Record<string, StripeEventHandler> = {
	'checkout.session.completed': processCheckoutEvent,
	'checkout.session.async_payment_succeeded': processCheckoutEvent,
	'charge.refunded': processRefundEvent,
	'charge.dispute.created': processDisputeEvent,
	'charge.dispute.updated': processDisputeEvent,
	'charge.dispute.closed': processDisputeEvent,
	'charge.dispute.funds_withdrawn': processDisputeEvent,
	'charge.dispute.funds_reinstated': processDisputeEvent,
	'customer.subscription.created': processSubscriptionEvent,
	'customer.subscription.updated': processSubscriptionEvent,
	'customer.subscription.deleted': processSubscriptionEvent,
	'customer.subscription.paused': processSubscriptionEvent,
	'customer.subscription.resumed': processSubscriptionEvent,
	'invoice.paid': processInvoiceEvent,
	'invoice.payment_failed': processInvoiceEvent,
	'invoice.payment_action_required': processInvoiceEvent,
	'invoice.finalization_failed': processInvoiceEvent,
	'customer.updated': processPaymentMethodEvent,
	'payment_method.attached': processPaymentMethodEvent,
	'payment_method.detached': processPaymentMethodEvent,
	'payment_method.updated': processPaymentMethodEvent,
};

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
	const handler = STRIPE_EVENT_HANDLERS[event.type];
	if (!handler) {
		return;
	}
	const stripeObject = event.data.object;
	await handler({
		type: event.type,
		objectId: (stripeObject as { id: string }).id,
		stripeObject,
		previousAttributes: event.data.previous_attributes,
	});
}

async function processStoredStripeEvent(event: { type: string; stripeObjectId: string | null }): Promise<void> {
	const handler = STRIPE_EVENT_HANDLERS[event.type];
	if (!handler) {
		return;
	}
	const objectId = event.stripeObjectId;
	if (!objectId) {
		throw new Error(`Stored Stripe event "${event.type}" has no object ID`);
	}
	await handler({ type: event.type, objectId });
}

async function processCheckoutEvent(event: ProcessableStripeEvent): Promise<void> {
	const session = event.stripeObject
		? (event.stripeObject as Stripe.Checkout.Session)
		: await getStripeCheckoutSession(event.objectId);
	if (isCreditTopUpCheckoutSession(session)) {
		if (event.type === 'checkout.session.completed' && session.payment_status !== 'paid') {
			return;
		}
		await settleCreditTopUpCheckout(event.objectId);
		return;
	}
	if (session.mode === 'subscription' && isCloudBillingPlanKey(session.metadata?.nao_plan_key)) {
		await processCheckoutSession(event.objectId);
	}
}

async function processRefundEvent(event: ProcessableStripeEvent): Promise<void> {
	await processRefundedCharge(event.objectId);
}

async function processDisputeEvent(event: ProcessableStripeEvent): Promise<void> {
	await processDispute(event.objectId);
}

async function processSubscriptionEvent(event: ProcessableStripeEvent): Promise<void> {
	await processSubscription(event.objectId);
}

async function processInvoiceEvent(event: ProcessableStripeEvent): Promise<void> {
	const invoice = event.stripeObject
		? (event.stripeObject as Stripe.Invoice)
		: await getStripeInvoice(event.objectId);
	await processInvoice(invoice);
}

async function processPaymentMethodEvent(event: ProcessableStripeEvent): Promise<void> {
	if (event.type === 'customer.updated') {
		await reconcileCloudBillingCustomer({ stripeCustomerId: event.objectId });
		return;
	}
	if (event.type === 'payment_method.detached' && !event.stripeObject) {
		await reconcileAllMappedCustomers();
		return;
	}
	const stripeObject =
		(event.stripeObject as Stripe.PaymentMethod | undefined) ?? (await getStripePaymentMethod(event.objectId));
	const previousAttributes = event.previousAttributes as { customer?: string | Stripe.Customer | null } | undefined;
	await reconcilePaymentMethod(stripeObject, previousAttributes);
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
	const purchase = await getCreditPurchaseForClawback(paymentIntentId);
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
	const purchase = await getCreditPurchaseForClawback(paymentIntentId);
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

async function getCreditPurchaseForClawback(paymentIntentId: string) {
	const purchase = await getCreditPurchaseByPaymentIntent(paymentIntentId);
	if (purchase || !isCreditTopUpPaymentIntent(await getStripePaymentIntent(paymentIntentId))) {
		return purchase;
	}
	throw new Error(`Credit purchase for Stripe PaymentIntent "${paymentIntentId}" has not been credited yet`);
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

async function reconcilePaymentMethod(
	stripeObject: Stripe.PaymentMethod,
	previousAttributes?: { customer?: string | Stripe.Customer | null },
): Promise<void> {
	const customer = stripeObject.customer ?? previousAttributes?.customer;
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

function optionalStripeId(value: string | { id: string } | null): string | null {
	return value ? (typeof value === 'string' ? value : value.id) : null;
}
