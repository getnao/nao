import Stripe from 'stripe';

import { CLOUD_BILLING_CURRENCIES, type CloudBillingCurrency, type CloudBillingPlanKey } from '../types/billing';
import { type CloudSubscriptionChangeIntent, cloudSubscriptionChangeIntentMetadata } from '../utils/stripe';
import {
	assertCloudSubscriptionOrganization,
	type CloudPaidProductItem,
	cloudPaidProductItem,
	cloudPriceAmount,
	type CloudRecurringPriceDetails,
	getCloudPrice,
	getStripeClient,
	getStripeInvoice,
	stripeDate,
	stripeId,
	stripeProductId,
	stripeTimestamp,
} from './stripe.service';

export interface CloudSubscriptionChangePreview {
	amountDue: number;
	subtotal: number;
	tax: number;
	discount: number;
	currency: CloudBillingCurrency;
	lines: Array<{
		description: string;
		amount: number;
		currency: CloudBillingCurrency;
		proration: boolean;
		periodStartsAt: Date | null;
		periodEndsAt: Date | null;
	}>;
}

export interface CloudPromotionCodeMatch {
	id: string;
	discountedPlanAmount: number;
	duration: Stripe.Coupon.Duration;
}

export type CloudSubscriptionChangeResult =
	| { status: 'completed'; subscription: Stripe.Subscription }
	| {
			status: 'payment_pending';
			subscription: Stripe.Subscription;
			hostedInvoiceUrl: string;
			expiresAt: Date;
	  };

export async function findActiveCloudPromotionCode(input: {
	code: string;
	stripeCustomerId: string;
	targetPlanKey: CloudBillingPlanKey;
	targetQuantity: number;
	currency: string;
}): Promise<CloudPromotionCodeMatch | null> {
	const first = await findActivePromotionCode(input.code);
	const promotionCode =
		!first?.customer || stripeId(first.customer) === input.stripeCustomerId
			? first
			: await findActivePromotionCode(input.code, input.stripeCustomerId);
	if (!promotionCode) {
		return null;
	}
	const price = await getCloudPrice(input.targetPlanKey);
	const coupon = expandedPromotionCodeCoupon(promotionCode);
	return {
		id: promotionCode.id,
		discountedPlanAmount: discountedPlanAmount(price, input.targetQuantity, coupon, input.currency),
		duration: coupon.duration,
	};
}

export async function previewCloudSubscriptionChange(input: {
	subscription: Stripe.Subscription;
	targetPlanKey: CloudBillingPlanKey;
	targetQuantity: number;
	prorationDate: Date;
	prorationBehavior: 'always_invoice' | 'none';
	promotionCodeId?: string;
}): Promise<CloudSubscriptionChangePreview> {
	const paidItem = requireCloudPaidProductItem(input.subscription);
	const price = await getCloudPrice(input.targetPlanKey);
	const invoice = await getStripeClient().invoices.createPreview({
		subscription: input.subscription.id,
		...(input.promotionCodeId ? { discounts: [{ promotion_code: input.promotionCodeId }] } : {}),
		subscription_details: {
			items: [{ id: paidItem.item.id, price: price.id, quantity: input.targetQuantity }],
			...prorationParams(input.prorationBehavior, input.prorationDate),
			...trialPreservationParams(input.subscription),
		},
	});
	const currency = assertCloudBillingCurrency(invoice.currency);
	return {
		amountDue: invoice.amount_due,
		subtotal: invoice.subtotal,
		tax: (invoice.total_taxes ?? []).reduce((total, tax) => total + tax.amount, 0),
		discount: (invoice.total_discount_amounts ?? []).reduce((total, discount) => total + discount.amount, 0),
		currency,
		lines: invoice.lines.data.map((line) => ({
			description: line.description ?? '',
			amount: line.amount,
			currency: assertCloudBillingCurrency(line.currency),
			proration: line.parent?.subscription_item_details?.proration === true,
			periodStartsAt: stripeDate(line.period?.start ?? null),
			periodEndsAt: stripeDate(line.period?.end ?? null),
		})),
	};
}

export async function updateCloudSubscriptionQuantity(input: {
	organizationId: string;
	subscription: Stripe.Subscription;
	targetQuantity: number;
	prorationDate: Date;
	requestId: string;
	promotionCodeId?: string;
	intent?: CloudSubscriptionChangeIntent;
}): Promise<CloudSubscriptionChangeResult> {
	const paidItem = requireCloudPaidProductItem(input.subscription);
	assertCloudSubscriptionOrganization(input.subscription, input.organizationId);
	const currentQuantity = paidItem.item.quantity ?? 1;
	const paidIncrease = input.subscription.status !== 'trialing' && input.targetQuantity > currentQuantity;
	const existingPendingChange = await getPendingCloudSubscriptionChange(input.subscription);
	if (existingPendingChange) {
		return existingPendingChange;
	}
	const subscription = await getStripeClient().subscriptions.update(
		input.subscription.id,
		{
			items: [{ id: paidItem.item.id, quantity: input.targetQuantity }],
			...(input.promotionCodeId ? { discounts: [{ promotion_code: input.promotionCodeId }] } : {}),
			...(input.intent ? { metadata: cloudSubscriptionChangeIntentMetadata(input.intent) } : {}),
			...prorationParams(paidIncrease ? 'always_invoice' : 'none', input.prorationDate),
			...(paidIncrease ? { payment_behavior: 'pending_if_incomplete' as const } : {}),
			...trialPreservationParams(input.subscription),
			expand: ['latest_invoice'],
		},
		{
			idempotencyKey: `cloud-seat-quantity-v2:${input.organizationId}:${input.subscription.id}:${input.requestId}:${input.targetQuantity}:${input.promotionCodeId ?? 'keep-discounts'}`,
		},
	);
	return toCloudSubscriptionChangeResult(subscription);
}

export async function updateCloudSubscriptionPlan(input: {
	organizationId: string;
	subscription: Stripe.Subscription;
	targetPlanKey: CloudBillingPlanKey;
	targetQuantity: number;
	prorationDate: Date;
	requestId: string;
	chargeImmediately: boolean;
	promotionCodeId?: string;
	intent?: CloudSubscriptionChangeIntent;
}): Promise<CloudSubscriptionChangeResult> {
	const paidItem = requireCloudPaidProductItem(input.subscription);
	assertCloudSubscriptionOrganization(input.subscription, input.organizationId);
	const existingPendingChange = await getPendingCloudSubscriptionChange(input.subscription);
	if (existingPendingChange) {
		return existingPendingChange;
	}
	const price = await getCloudPrice(input.targetPlanKey);
	const paidUpgrade = input.subscription.status !== 'trialing' && input.chargeImmediately;
	const subscription = await getStripeClient().subscriptions.update(
		input.subscription.id,
		{
			cancel_at_period_end: false,
			items: [{ id: paidItem.item.id, price: price.id, quantity: input.targetQuantity }],
			...(input.promotionCodeId ? { discounts: [{ promotion_code: input.promotionCodeId }] } : {}),
			...(input.intent ? { metadata: cloudSubscriptionChangeIntentMetadata(input.intent) } : {}),
			...prorationParams(paidUpgrade ? 'always_invoice' : 'none', input.prorationDate),
			...(paidUpgrade ? { payment_behavior: 'pending_if_incomplete' as const } : {}),
			...trialPreservationParams(input.subscription),
			expand: ['latest_invoice'],
		},
		{
			idempotencyKey: `cloud-plan-change-v3:${input.organizationId}:${input.subscription.id}:${input.requestId}:${input.targetPlanKey}:${input.targetQuantity}:${input.promotionCodeId ?? 'keep-discounts'}`,
		},
	);
	return toCloudSubscriptionChangeResult(subscription);
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
}): Promise<Stripe.Subscription> {
	assertCloudSubscriptionOrganization(input.subscription, input.organizationId);
	return getStripeClient().subscriptions.update(
		input.subscription.id,
		{ cancel_at_period_end: input.cancelAtPeriodEnd, proration_behavior: 'none' },
		{
			idempotencyKey: `cloud-switch-free-v1:${input.organizationId}:${input.subscription.id}:${input.requestId}`,
		},
	);
}

export async function createCloudPlanChangeSchedule(input: {
	organizationId: string;
	subscription: Stripe.Subscription;
	targetPlanKey: CloudBillingPlanKey;
	requestId: string;
}): Promise<Stripe.SubscriptionSchedule> {
	assertCloudSubscriptionOrganization(input.subscription, input.organizationId);
	return getStripeClient().subscriptionSchedules.create(
		{ from_subscription: input.subscription.id },
		{
			idempotencyKey: `cloud-plan-schedule-v1:${input.organizationId}:${input.subscription.id}:${input.requestId}:${input.targetPlanKey}`,
		},
	);
}

export async function getCloudPlanChangeSchedule(scheduleId: string): Promise<Stripe.SubscriptionSchedule> {
	return getStripeClient().subscriptionSchedules.retrieve(scheduleId, {
		expand: ['phases.items.price.product'],
	});
}

export async function updateCloudPlanChangeSchedule(input: {
	schedule: Stripe.SubscriptionSchedule;
	targetPlanKey: CloudBillingPlanKey;
	targetQuantity: number;
	effectiveAt: Date;
	promotionCodeId?: string;
}): Promise<Stripe.SubscriptionSchedule> {
	const price = await getCloudPrice(input.targetPlanKey);
	const currentPhase = input.schedule.phases.find(
		(phase) =>
			phase.start_date <= stripeTimestamp(input.effectiveAt) &&
			phase.end_date >= stripeTimestamp(input.effectiveAt),
	);
	if (!currentPhase) {
		throw new Error(`Stripe Subscription Schedule "${input.schedule.id}" has no current phase`);
	}
	const currentPhaseParams = copyCloudSchedulePhase(
		currentPhase,
		currentPhase.start_date,
		stripeTimestamp(input.effectiveAt),
	);
	const {
		start_date: _currentStartDate,
		end_date: _currentEndDate,
		items: _currentItems,
		...futurePhaseSettings
	} = currentPhaseParams;
	return getStripeClient().subscriptionSchedules.update(input.schedule.id, {
		end_behavior: 'release',
		proration_behavior: 'none',
		phases: [
			currentPhaseParams,
			{
				...futurePhaseSettings,
				start_date: stripeTimestamp(input.effectiveAt),
				items: [{ price: price.id, quantity: input.targetQuantity }],
				...(input.promotionCodeId ? { discounts: [{ promotion_code: input.promotionCodeId }] } : {}),
				proration_behavior: 'none',
			},
		],
	});
}

export async function releaseCloudPlanChangeSchedule(scheduleId: string): Promise<Stripe.SubscriptionSchedule> {
	return getStripeClient().subscriptionSchedules.release(scheduleId, { preserve_cancel_date: true });
}

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

/** Stripe rejects `proration_date` when `proration_behavior` is `none`. */
function prorationParams(behavior: 'always_invoice' | 'none', prorationDate: Date) {
	return behavior === 'none'
		? { proration_behavior: behavior }
		: { proration_behavior: behavior, proration_date: stripeTimestamp(prorationDate) };
}

function trialPreservationParams(subscription: Stripe.Subscription) {
	return subscription.status === 'trialing' && subscription.trial_end
		? { cancel_at_period_end: false, trial_end: subscription.trial_end }
		: {};
}

export async function getPendingCloudSubscriptionChange(
	subscription: Stripe.Subscription,
): Promise<Extract<CloudSubscriptionChangeResult, { status: 'payment_pending' }> | null> {
	return subscription.pending_update ? toPendingCloudSubscriptionChange(subscription) : null;
}

async function toCloudSubscriptionChangeResult(
	subscription: Stripe.Subscription,
): Promise<CloudSubscriptionChangeResult> {
	return subscription.pending_update
		? toPendingCloudSubscriptionChange(subscription)
		: { status: 'completed', subscription };
}

async function toPendingCloudSubscriptionChange(
	subscription: Stripe.Subscription,
): Promise<Extract<CloudSubscriptionChangeResult, { status: 'payment_pending' }>> {
	if (!subscription.pending_update) {
		throw new Error(`Stripe Subscription "${subscription.id}" has no pending update`);
	}
	if (!subscription.latest_invoice) {
		throw new Error(`Stripe Subscription "${subscription.id}" has no invoice for its pending update`);
	}
	const invoice =
		typeof subscription.latest_invoice === 'string'
			? await getStripeInvoice(subscription.latest_invoice)
			: subscription.latest_invoice;
	if (!invoice.hosted_invoice_url) {
		throw new Error(`Stripe Invoice "${invoice.id}" has no hosted payment URL`);
	}
	return {
		status: 'payment_pending',
		subscription,
		hostedInvoiceUrl: invoice.hosted_invoice_url,
		expiresAt: new Date(subscription.pending_update.expires_at * 1_000),
	};
}

function requireCloudPaidProductItem(subscription: Stripe.Subscription): CloudPaidProductItem {
	const paidItem = cloudPaidProductItem(subscription);
	if (!paidItem) {
		throw new Error(`Stripe Subscription "${subscription.id}" has no cloud plan item`);
	}
	return paidItem;
}

function assertCloudBillingCurrency(currency: string): CloudBillingCurrency {
	if (!(CLOUD_BILLING_CURRENCIES as readonly string[]).includes(currency)) {
		throw new Error(`Stripe returned unsupported billing currency "${currency}"`);
	}
	return currency as CloudBillingCurrency;
}

async function findActivePromotionCode(
	code: string,
	stripeCustomerId?: string,
): Promise<Stripe.PromotionCode | undefined> {
	const promotionCodes = await getStripeClient().promotionCodes.list({
		active: true,
		code,
		...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
		expand: ['data.promotion.coupon'],
		limit: 1,
	});
	return promotionCodes.data[0];
}

function expandedPromotionCodeCoupon(promotionCode: Stripe.PromotionCode): Stripe.Coupon {
	if (
		promotionCode.promotion.type !== 'coupon' ||
		!promotionCode.promotion.coupon ||
		typeof promotionCode.promotion.coupon === 'string'
	) {
		throw new Error(`Stripe Promotion Code "${promotionCode.id}" has no expanded Coupon`);
	}
	return promotionCode.promotion.coupon;
}

function discountedPlanAmount(
	price: CloudRecurringPriceDetails,
	quantity: number,
	coupon: Stripe.Coupon,
	currency: string,
): number {
	const unitAmount = cloudPriceAmount(price, currency);
	if (unitAmount === null) {
		throw new Error(`Stripe Price "${price.id}" does not support ${currency.toUpperCase()}`);
	}
	const amount = unitAmount * quantity;
	if (coupon.applies_to?.products.length && !coupon.applies_to.products.includes(stripeProductId(price.product))) {
		return amount;
	}
	if (coupon.percent_off !== null) {
		return Math.max(0, amount - Math.round((amount * coupon.percent_off) / 100));
	}
	const amountOff =
		coupon.currency_options?.[currency]?.amount_off ??
		(coupon.currency === currency ? coupon.amount_off : null) ??
		0;
	return Math.max(0, amount - amountOff);
}

function copyCloudSchedulePhase(phase: Stripe.SubscriptionSchedule.Phase, startDate: number, endDate: number) {
	return {
		start_date: startDate,
		end_date: endDate,
		items: phase.items.map((item) => ({
			price: typeof item.price === 'string' ? item.price : item.price.id,
			quantity: item.quantity ?? 1,
			...(item.metadata ? { metadata: item.metadata } : {}),
			...(item.tax_rates ? { tax_rates: item.tax_rates.map(stripeId) } : {}),
			...(item.billing_thresholds?.usage_gte
				? { billing_thresholds: { usage_gte: item.billing_thresholds.usage_gte } }
				: {}),
			...(item.discounts?.length > 0 ? { discounts: item.discounts.map(copyCloudScheduleDiscount) } : {}),
		})),
		proration_behavior: phase.proration_behavior,
		...(phase.automatic_tax
			? {
					automatic_tax: {
						enabled: phase.automatic_tax.enabled,
						...(phase.automatic_tax.liability
							? {
									liability: {
										type: phase.automatic_tax.liability.type,
										...(phase.automatic_tax.liability.account
											? { account: stripeId(phase.automatic_tax.liability.account) }
											: {}),
									},
								}
							: {}),
					},
				}
			: {}),
		...(phase.billing_cycle_anchor ? { billing_cycle_anchor: phase.billing_cycle_anchor } : {}),
		...(phase.billing_thresholds
			? {
					billing_thresholds: {
						...(phase.billing_thresholds.amount_gte === null
							? {}
							: { amount_gte: phase.billing_thresholds.amount_gte }),
						...(phase.billing_thresholds.reset_billing_cycle_anchor === null
							? {}
							: { reset_billing_cycle_anchor: phase.billing_thresholds.reset_billing_cycle_anchor }),
					},
				}
			: {}),
		...(phase.collection_method ? { collection_method: phase.collection_method } : {}),
		...(phase.default_payment_method ? { default_payment_method: stripeId(phase.default_payment_method) } : {}),
		...(phase.default_tax_rates ? { default_tax_rates: phase.default_tax_rates.map(stripeId) } : {}),
		...(phase.description ? { description: phase.description } : {}),
		...(phase.discounts?.length > 0 ? { discounts: phase.discounts.map(copyCloudScheduleDiscount) } : {}),
		...(phase.invoice_settings
			? { invoice_settings: copyCloudScheduleInvoiceSettings(phase.invoice_settings) }
			: {}),
		...(phase.metadata ? { metadata: phase.metadata } : {}),
		...(phase.on_behalf_of ? { on_behalf_of: stripeId(phase.on_behalf_of) } : {}),
		...(phase.transfer_data
			? {
					transfer_data: {
						amount_percent: phase.transfer_data.amount_percent ?? undefined,
						destination: stripeId(phase.transfer_data.destination),
					},
				}
			: {}),
		...(phase.trial_end ? { trial_end: phase.trial_end } : {}),
	};
}

function copyCloudScheduleInvoiceSettings(settings: Stripe.SubscriptionSchedule.Phase.InvoiceSettings) {
	return {
		...(settings.account_tax_ids ? { account_tax_ids: settings.account_tax_ids.map(stripeId) } : {}),
		...(settings.custom_fields ? { custom_fields: settings.custom_fields } : {}),
		...(settings.days_until_due === null ? {} : { days_until_due: settings.days_until_due }),
		...(settings.description === null ? {} : { description: settings.description }),
		...(settings.footer === null ? {} : { footer: settings.footer }),
		...(settings.issuer
			? {
					issuer: {
						type: settings.issuer.type,
						...(settings.issuer.account ? { account: stripeId(settings.issuer.account) } : {}),
					},
				}
			: {}),
	};
}

function copyCloudScheduleDiscount(discount: Stripe.SubscriptionSchedule.Phase.Discount) {
	if (discount.discount) {
		return { discount: stripeId(discount.discount) };
	}
	if (discount.promotion_code) {
		return { promotion_code: stripeId(discount.promotion_code) };
	}
	if (discount.coupon) {
		return { coupon: stripeId(discount.coupon) };
	}
	throw new Error('Stripe Subscription Schedule contains an invalid discount');
}
