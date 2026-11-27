import type Stripe from 'stripe';

import { type CloudBillingPlanKey } from '../types/billing';
import { type CloudSubscriptionChangeIntent, cloudSubscriptionChangeIntentMetadata, stripeId } from '../utils/stripe';
import {
	assertCloudSubscriptionOrganization,
	cloudPaidItem,
	cloudPriceAmount,
	getCloudPrice,
	getCloudSubscriptionSchedule,
	getStripeClient,
	getStripeInvoice,
	stripeDate,
	stripeTimestamp,
} from './stripe.service';

export type CloudSubscriptionChange = {
	subscription: Stripe.Subscription;
	targetPlanKey: CloudBillingPlanKey;
	targetQuantity: number;
	prorationDate: Date;
	chargeNow: boolean;
	promotionCodeId?: string;
};

export type CloudSubscriptionChangeResult =
	| { status: 'completed' }
	| { status: 'payment_pending'; hostedInvoiceUrl: string; expiresAt: Date };

export async function previewCloudSubscriptionChange(change: CloudSubscriptionChange) {
	const invoice = await getStripeClient().invoices.createPreview({
		subscription: change.subscription.id,
		...(change.promotionCodeId ? { discounts: [{ promotion_code: change.promotionCodeId }] } : {}),
		subscription_details: await subscriptionChangeParams(change),
	});
	return {
		amountDue: invoice.amount_due,
		subtotal: invoice.subtotal,
		tax: (invoice.total_taxes ?? []).reduce((total, tax) => total + tax.amount, 0),
		discount: (invoice.total_discount_amounts ?? []).reduce((total, discount) => total + discount.amount, 0),
		currency: invoice.currency,
		lines: invoice.lines.data.map((line) => ({
			description: line.description ?? '',
			amount: line.amount,
			proration: line.parent?.subscription_item_details?.proration === true,
			periodStartsAt: stripeDate(line.period?.start ?? null),
			periodEndsAt: stripeDate(line.period?.end ?? null),
		})),
	};
}

/** Paid upgrades only apply once their invoice is paid; until then Stripe keeps them as a pending update. */
export async function applyCloudSubscriptionChange(
	change: CloudSubscriptionChange & {
		organizationId: string;
		requestId: string;
		intent: CloudSubscriptionChangeIntent;
	},
): Promise<CloudSubscriptionChangeResult> {
	assertCloudSubscriptionOrganization(change.subscription, change.organizationId);
	const subscription = await getStripeClient().subscriptions.update(
		change.subscription.id,
		{
			...(await subscriptionChangeParams(change)),
			...(change.promotionCodeId ? { discounts: [{ promotion_code: change.promotionCodeId }] } : {}),
			...(change.chargeNow ? { payment_behavior: 'pending_if_incomplete' as const } : {}),
			metadata: cloudSubscriptionChangeIntentMetadata(change.intent),
			expand: ['latest_invoice'],
		},
		{
			idempotencyKey: `cloud-subscription-change-v1:${change.organizationId}:${change.subscription.id}:${change.requestId}`,
		},
	);
	return toChangeResult(subscription);
}

export async function getPendingCloudSubscriptionChange(
	subscription: Stripe.Subscription,
): Promise<Extract<CloudSubscriptionChangeResult, { status: 'payment_pending' }> | null> {
	const result = subscription.pending_update ? await toChangeResult(subscription) : null;
	return result?.status === 'payment_pending' ? result : null;
}

export async function clearCloudSubscriptionChangeIntent(subscriptionId: string): Promise<void> {
	await getStripeClient().subscriptions.update(subscriptionId, {
		metadata: cloudSubscriptionChangeIntentMetadata(null),
	});
}

export async function setCloudSubscriptionCancellation(input: {
	organizationId: string;
	subscription: Stripe.Subscription;
	cancelAtPeriodEnd: boolean;
	requestId: string;
}): Promise<void> {
	assertCloudSubscriptionOrganization(input.subscription, input.organizationId);
	await getStripeClient().subscriptions.update(
		input.subscription.id,
		{ cancel_at_period_end: input.cancelAtPeriodEnd, proration_behavior: 'none' },
		{ idempotencyKey: `cloud-cancellation-v1:${input.organizationId}:${input.subscription.id}:${input.requestId}` },
	);
}

/** Creates the schedule on first use, then replaces its future phase with the target plan. */
export async function scheduleCloudSubscriptionChange(input: {
	organizationId: string;
	subscription: Stripe.Subscription;
	targetPlanKey: CloudBillingPlanKey;
	targetQuantity: number;
	promotionCodeId?: string;
	requestId: string;
}): Promise<void> {
	assertCloudSubscriptionOrganization(input.subscription, input.organizationId);
	const scheduleId = input.subscription.schedule
		? stripeId(input.subscription.schedule)
		: (
				await getStripeClient().subscriptionSchedules.create(
					{ from_subscription: input.subscription.id },
					{
						idempotencyKey: `cloud-schedule-v1:${input.organizationId}:${input.subscription.id}:${input.requestId}`,
					},
				)
			).id;
	const schedule = await getCloudSubscriptionSchedule(scheduleId);
	const now = stripeTimestamp(new Date());
	const currentPhase = schedule.phases.find((phase) => phase.start_date <= now && phase.end_date > now);
	if (!currentPhase) {
		throw new Error(`Stripe Subscription Schedule "${schedule.id}" has no current phase`);
	}
	const price = await getCloudPrice(input.targetPlanKey);
	const { items: _items, start_date: _start, end_date: _end, ...phaseSettings } = copyPhase(currentPhase);
	await getStripeClient().subscriptionSchedules.update(schedule.id, {
		end_behavior: 'release',
		proration_behavior: 'none',
		phases: [
			copyPhase(currentPhase),
			{
				...phaseSettings,
				...(input.promotionCodeId ? { discounts: [{ promotion_code: input.promotionCodeId }] } : {}),
				start_date: currentPhase.end_date,
				items: [{ price: price.id, quantity: input.targetQuantity }],
				proration_behavior: 'none',
			},
		],
	});
}

export async function releaseCloudSubscriptionSchedule(scheduleId: string): Promise<void> {
	await getStripeClient().subscriptionSchedules.release(scheduleId, { preserve_cancel_date: true });
}

/** Test clocks freeze time, so prorations must use the clock's time rather than ours. */
export async function getCloudProrationDate(subscription: Stripe.Subscription): Promise<Date> {
	if (!subscription.test_clock) {
		return new Date();
	}
	const testClock =
		typeof subscription.test_clock === 'string'
			? await getStripeClient().testHelpers.testClocks.retrieve(subscription.test_clock)
			: subscription.test_clock;
	return new Date(testClock.frozen_time * 1_000);
}

export async function findCloudPromotionCode(input: {
	code: string;
	stripeCustomerId: string;
	targetPlanKey: CloudBillingPlanKey;
	targetQuantity: number;
	currency: string;
}): Promise<{ id: string; discountedPlanAmount: number; duration: Stripe.Coupon.Duration } | null> {
	const promotionCode =
		(await findActivePromotionCode(input.code, input.stripeCustomerId)) ??
		(await findActivePromotionCode(input.code));
	if (!promotionCode || (promotionCode.customer && stripeId(promotionCode.customer) !== input.stripeCustomerId)) {
		return null;
	}
	const coupon = promotionCode.promotion.coupon;
	if (!coupon || typeof coupon === 'string') {
		throw new Error(`Stripe Promotion Code "${promotionCode.id}" has no expanded Coupon`);
	}
	const price = await getCloudPrice(input.targetPlanKey);
	const amount = (cloudPriceAmount(price, input.currency) ?? 0) * input.targetQuantity;
	const appliesToPlan = !coupon.applies_to?.products.length || coupon.applies_to.products.includes(price.product.id);
	const amountOff = coupon.currency_options?.[input.currency]?.amount_off ?? coupon.amount_off ?? 0;
	const discount = !appliesToPlan
		? 0
		: coupon.percent_off !== null
			? Math.round((amount * coupon.percent_off) / 100)
			: amountOff;
	return { id: promotionCode.id, discountedPlanAmount: Math.max(0, amount - discount), duration: coupon.duration };
}

async function subscriptionChangeParams(change: CloudSubscriptionChange) {
	const paidItem = cloudPaidItem(change.subscription);
	if (!paidItem) {
		throw new Error(`Stripe Subscription "${change.subscription.id}" has no cloud plan item`);
	}
	const price = await getCloudPrice(change.targetPlanKey);
	const trialEnd = change.subscription.status === 'trialing' ? change.subscription.trial_end : null;
	return {
		items: [{ id: paidItem.item.id, price: price.id, quantity: change.targetQuantity }],
		...(change.chargeNow
			? { proration_behavior: 'always_invoice' as const, proration_date: stripeTimestamp(change.prorationDate) }
			: { proration_behavior: 'none' as const }),
		...(trialEnd ? { trial_end: trialEnd } : {}),
		...(change.subscription.cancel_at_period_end ? { cancel_at_period_end: false } : {}),
	};
}

async function toChangeResult(subscription: Stripe.Subscription): Promise<CloudSubscriptionChangeResult> {
	if (!subscription.pending_update) {
		return { status: 'completed' };
	}
	const invoice =
		typeof subscription.latest_invoice === 'string'
			? await getStripeInvoice(subscription.latest_invoice)
			: subscription.latest_invoice;
	if (!invoice?.hosted_invoice_url) {
		throw new Error(`Stripe Subscription "${subscription.id}" has no payable invoice for its pending update`);
	}
	return {
		status: 'payment_pending',
		hostedInvoiceUrl: invoice.hosted_invoice_url,
		expiresAt: new Date(subscription.pending_update.expires_at * 1_000),
	};
}

async function findActivePromotionCode(code: string, customer?: string) {
	const { data } = await getStripeClient().promotionCodes.list({
		active: true,
		code,
		...(customer ? { customer } : {}),
		expand: ['data.promotion.coupon'],
		limit: 1,
	});
	return data[0];
}

/** ponytail: copies only the phase settings nao's Checkout subscriptions use; Stripe unsets omitted ones. */
function copyPhase(phase: Stripe.SubscriptionSchedule.Phase) {
	return {
		start_date: phase.start_date,
		end_date: phase.end_date,
		items: phase.items.map((item) => ({
			price: stripeId(item.price),
			quantity: item.quantity ?? 1,
			...(item.discounts.length > 0 ? { discounts: item.discounts.map(copyDiscount) } : {}),
		})),
		...(phase.discounts.length > 0 ? { discounts: phase.discounts.map(copyDiscount) } : {}),
		...(phase.metadata ? { metadata: phase.metadata } : {}),
		...(phase.automatic_tax ? { automatic_tax: { enabled: phase.automatic_tax.enabled } } : {}),
		...(phase.default_payment_method ? { default_payment_method: stripeId(phase.default_payment_method) } : {}),
		...(phase.collection_method ? { collection_method: phase.collection_method } : {}),
	};
}

function copyDiscount(discount: Stripe.SubscriptionSchedule.Phase.Discount) {
	if (discount.discount) {
		return { discount: stripeId(discount.discount) };
	}
	if (discount.promotion_code) {
		return { promotion_code: stripeId(discount.promotion_code) };
	}
	return { coupon: stripeId(discount.coupon!) };
}
