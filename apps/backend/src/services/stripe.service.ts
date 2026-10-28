import Stripe from 'stripe';

import { env, isCloudBillingEnabled } from '../env';
import type { SubscriptionProjection } from '../queries/billing.queries';
import {
	BILLING_STATUSES,
	type BillingStatus,
	CLOUD_BILLING_CURRENCIES,
	CLOUD_BILLING_PLANS,
	type CloudBillingCurrency,
	type CloudBillingInterval,
	type CloudBillingPlan,
	type CloudBillingPlanDefinition,
	isCloudBillingPlanKey,
	isTerminalBillingStatus,
} from '../types/billing';

const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-08-26.dahlia';
const CLOUD_PRICE_CACHE_TTL_MS = 5 * 60 * 1000;
const SUBSCRIPTION_CURRENCY_CACHE_LIMIT = 1_000;
const ORGANIZATION_METADATA_KEY = 'nao_org_id';
const PLAN_METADATA_KEY = 'nao_plan_key';
const SUBSCRIPTION_KIND_METADATA_KEY = 'nao_subscription_kind';
const TRIAL_PLACEHOLDER_KIND = 'trial-placeholder';
const CHECKOUT_KIND_METADATA_KEY = 'nao_checkout_kind';
const CREDIT_TOP_UP_CHECKOUT_KIND = 'credit_top_up';
const TRIAL_END_METADATA_KEY = 'nao_trial_end';
const MIN_CHECKOUT_TRIAL_MS = 48 * 60 * 60 * 1000;
const CHECKOUT_TRIAL_CLOCK_SKEW_MS = 5 * 60 * 1000;

type CloudRecurringPriceDetails = Stripe.Price & {
	recurring: Stripe.Price.Recurring;
	unit_amount: number;
};

type CloudPrice = CloudRecurringPriceDetails & {
	product: Stripe.Product;
};

type CloudTrialPrice = Stripe.Price & {
	product: Stripe.Product;
	recurring: Stripe.Price.Recurring;
	unit_amount: 0;
};

type CloudSubscriptionItem = Stripe.SubscriptionItem & {
	price: CloudRecurringPriceDetails;
};

export type CloudSubscriptionKind = 'paid-cloud' | 'trial-placeholder';

export interface ClassifiedCloudSubscription {
	kind: CloudSubscriptionKind;
	subscription: Stripe.Subscription;
}

interface CloudInvoice {
	id: string;
	number: string | null;
	invoiceKind: 'trial' | 'subscription' | 'credit_top_up' | 'no_charge';
	promotionCodes: string[];
	status: Stripe.Invoice.Status | null;
	createdAt: Date;
	total: number;
	currency: string;
	hostedInvoiceUrl: string | null;
	invoicePdf: string | null;
}

interface CloudUpcomingInvoice {
	amountDue: number;
	currency: string;
	nextPaymentAt: Date;
	promotionCodes: string[];
}

export interface StripeAccountInvoice {
	id: string;
	number: string | null;
	stripeCustomerId: string | null;
	status: Stripe.Invoice.Status | null;
	billingReason: Stripe.Invoice.BillingReason | null;
	invoiceKind: 'subscription' | 'credit_top_up';
	total: number;
	amountPaid: number;
	currency: string;
	attemptCount: number;
	createdAt: Date;
	paidAt: Date | null;
	hostedInvoiceUrl: string | null;
}

export interface CloudSubscriptionRevenue {
	id: string;
	stripeCustomerId: string;
	status: Stripe.Subscription.Status;
	currency: string;
	monthlyAmount: number;
}

export class CloudInitialCheckoutUnavailableError extends Error {}

export class CloudSubscriptionUnavailableError extends Error {}

export class CloudSubscriptionResumeError extends Error {}

let stripeClient: Stripe | undefined;
const cloudPriceCache = new Map<
	CloudBillingInterval,
	{ lookupKey: string; productId: string; expiresAt: number; price: Promise<CloudPrice> }
>();
let cloudTrialPriceCache:
	| { lookupKey: string; productId: string; expiresAt: number; price: Promise<CloudTrialPrice> }
	| undefined;
const subscriptionCurrencyCache = new Map<string, Promise<string>>();
const priceCurrencyOptionsCache = new Map<string, Promise<Stripe.Price>>();

export async function createCloudCustomer(input: {
	organizationId: string;
	organizationName: string;
	adminEmail: string;
}): Promise<Stripe.Customer> {
	return getStripeClient().customers.create(
		{
			name: input.organizationName,
			email: input.adminEmail,
			metadata: { [ORGANIZATION_METADATA_KEY]: input.organizationId },
		},
		{ idempotencyKey: `cloud-customer-v2:${input.organizationId}` },
	);
}

export async function createCloudTrialPlaceholderSubscription(input: {
	organizationId: string;
	stripeCustomerId: string;
	trialEnd: Date;
}): Promise<Stripe.Subscription> {
	if (input.trialEnd.getTime() <= Date.now()) {
		throw new Error('The organization trial has expired');
	}
	const price = await getCloudTrialPrice();
	return getStripeClient().subscriptions.create(
		{
			customer: input.stripeCustomerId,
			items: [{ price: price.id, quantity: 1 }],
			metadata: {
				[ORGANIZATION_METADATA_KEY]: input.organizationId,
				[SUBSCRIPTION_KIND_METADATA_KEY]: TRIAL_PLACEHOLDER_KIND,
			},
			cancel_at: stripeTimestamp(input.trialEnd),
			trial_end: stripeTimestamp(input.trialEnd),
			trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
		},
		{ idempotencyKey: `cloud-trial-placeholder-v1:${input.organizationId}` },
	);
}

export async function createCloudCheckoutSession(input: {
	billingInterval: CloudBillingInterval;
	currency?: CloudBillingCurrency;
	organizationId: string;
	stripeCustomerId: string;
	trialEnd: Date;
}): Promise<string> {
	const classified = await listCloudSubscriptions(input.stripeCustomerId);
	const hasPaidHistory = classified.some(({ kind }) => kind === 'paid-cloud');
	const currentPlaceholders = classified.filter(
		({ kind, subscription }) => kind === 'trial-placeholder' && !isTerminalBillingStatus(subscription.status),
	);
	if (hasPaidHistory || (classified.length > 0 && currentPlaceholders.length !== 1)) {
		throw new CloudInitialCheckoutUnavailableError(
			'This organization already has cloud subscription history; use resubscribe instead',
		);
	}
	if (input.trialEnd.getTime() <= Date.now()) {
		throw new CloudInitialCheckoutUnavailableError('This organization trial has expired');
	}
	const preservesTrial =
		input.trialEnd.getTime() >= Date.now() + MIN_CHECKOUT_TRIAL_MS + CHECKOUT_TRIAL_CLOCK_SKEW_MS;
	const sourceTrialEnd = preservesTrial ? stripeTimestamp(input.trialEnd) : null;
	return createSubscriptionCheckoutSession({
		...input,
		trialEnd: preservesTrial ? input.trialEnd : undefined,
		currency: input.currency ?? 'usd',
		kind: 'initial',
		operationKey: sourceTrialEnd === null ? 'immediate' : `trial-${sourceTrialEnd}-${sourceTrialEnd}`,
		effectiveTrialEnd: sourceTrialEnd,
	});
}

export async function createCloudResubscribeSession(input: {
	billingInterval: CloudBillingInterval;
	currency?: CloudBillingCurrency;
	organizationId: string;
	stripeCustomerId: string;
	allowMissingHistory?: boolean;
}): Promise<string> {
	const classified = await listCloudSubscriptions(input.stripeCustomerId);
	if (classified.some(({ subscription }) => !isTerminalBillingStatus(subscription.status))) {
		throw new CloudSubscriptionUnavailableError('This organization already has a current subscription');
	}
	const latestSubscription = [...classified].sort(
		(left, right) => right.subscription.created - left.subscription.created,
	)[0]?.subscription;
	if (!latestSubscription && !input.allowMissingHistory) {
		throw new CloudSubscriptionUnavailableError('This organization has no subscription history');
	}
	return createSubscriptionCheckoutSession({
		...input,
		currency: input.currency ?? 'usd',
		kind: 'resubscribe',
		operationKey: latestSubscription?.id ?? 'missing-subscription',
	});
}

async function createSubscriptionCheckoutSession(input: {
	billingInterval: CloudBillingInterval;
	currency: CloudBillingCurrency;
	organizationId: string;
	stripeCustomerId: string;
	kind: 'initial' | 'resubscribe';
	operationKey: string;
	trialEnd?: Date;
	effectiveTrialEnd?: number | null;
}): Promise<string> {
	const plan = CLOUD_BILLING_PLANS[input.billingInterval];
	const sourceTrialEnd = input.trialEnd ? stripeTimestamp(input.trialEnd) : null;
	const effectiveTrialEnd = input.effectiveTrialEnd ?? null;
	const trialMessage =
		effectiveTrialEnd !== null
			? checkoutTrialMessage(new Date(effectiveTrialEnd * 1_000))
			: input.kind === 'initial'
				? checkoutImmediateStartMessage()
				: null;
	const matchesCheckout = (session: Stripe.Checkout.Session) =>
		session.mode === 'subscription' &&
		session.currency === input.currency &&
		session.allow_promotion_codes === true &&
		session.metadata?.[ORGANIZATION_METADATA_KEY] === input.organizationId &&
		session.metadata?.[PLAN_METADATA_KEY] === plan.key &&
		session.metadata?.[CHECKOUT_KIND_METADATA_KEY] === input.kind &&
		(session.metadata?.[TRIAL_END_METADATA_KEY] ?? null) ===
			(sourceTrialEnd === null ? null : String(sourceTrialEnd)) &&
		(trialMessage === null || session.custom_text?.submit?.message === trialMessage);
	const existingSession = await reuseOrExpireOpenCheckoutSessions(input, matchesCheckout);
	if (existingSession?.url) {
		return existingSession.url;
	}
	const latestExpiredSession = await findCheckoutSession(input.stripeCustomerId, 'expired', matchesCheckout);

	const price = await getCloudPrice(input.billingInterval);
	const billingUrl = billingPageUrl();
	const session = await getStripeClient().checkout.sessions.create(
		{
			mode: 'subscription',
			currency: input.currency,
			customer: input.stripeCustomerId,
			customer_update: { address: 'auto', name: 'auto' },
			automatic_tax: { enabled: true },
			tax_id_collection: { enabled: true },
			billing_address_collection: 'required',
			client_reference_id: input.organizationId,
			line_items: [{ price: price.id, quantity: 1 }],
			allow_promotion_codes: true,
			payment_method_collection: 'always',
			payment_method_types: ['card'],
			...(trialMessage ? { custom_text: { submit: { message: trialMessage } } } : {}),
			metadata: {
				[ORGANIZATION_METADATA_KEY]: input.organizationId,
				[PLAN_METADATA_KEY]: plan.key,
				[CHECKOUT_KIND_METADATA_KEY]: input.kind,
				...(sourceTrialEnd === null ? {} : { [TRIAL_END_METADATA_KEY]: String(sourceTrialEnd) }),
			},
			subscription_data: {
				metadata: {
					[ORGANIZATION_METADATA_KEY]: input.organizationId,
					[PLAN_METADATA_KEY]: plan.key,
				},
				...(effectiveTrialEnd !== null
					? {
							trial_end: effectiveTrialEnd,
							trial_settings: { end_behavior: { missing_payment_method: 'pause' as const } },
						}
					: {}),
			},
			success_url: `${billingUrl}?checkout=${input.kind === 'initial' ? 'success' : 'subscribed'}`,
			cancel_url: `${billingUrl}?checkout=canceled`,
		},
		{
			idempotencyKey: `cloud-checkout-${input.kind}-v12:${input.organizationId}:${plan.key}:${input.currency}:${input.operationKey}${latestExpiredSession ? `:${latestExpiredSession.id}` : ''}`,
		},
	);
	if (!session.url) {
		throw new Error('Stripe did not return a Checkout URL');
	}
	return session.url;
}

export async function createCloudPortalSession(input: {
	organizationId: string;
	stripeCustomerId: string;
	requestId: string;
}): Promise<string> {
	const session = await getStripeClient().billingPortal.sessions.create(
		{
			customer: input.stripeCustomerId,
			return_url: `${billingPageUrl()}?portal=returned`,
			...(env.STRIPE_PORTAL_CONFIGURATION_ID ? { configuration: env.STRIPE_PORTAL_CONFIGURATION_ID } : {}),
		},
		{ idempotencyKey: `cloud-portal-v2:${input.organizationId}:${input.requestId}` },
	);
	return session.url;
}

export async function createCloudPaymentMethodSession(input: {
	organizationId: string;
	stripeCustomerId: string;
	requestId: string;
}): Promise<string> {
	const returnUrl = `${billingPageUrl()}?portal=returned`;
	const session = await getStripeClient().billingPortal.sessions.create(
		{
			customer: input.stripeCustomerId,
			return_url: returnUrl,
			flow_data: {
				type: 'payment_method_update',
				after_completion: {
					type: 'redirect',
					redirect: { return_url: returnUrl },
				},
			},
			...(env.STRIPE_PORTAL_CONFIGURATION_ID ? { configuration: env.STRIPE_PORTAL_CONFIGURATION_ID } : {}),
		},
		{ idempotencyKey: `cloud-payment-method-v2:${input.organizationId}:${input.requestId}` },
	);
	return session.url;
}

export async function listCloudInvoices(stripeCustomerId: string): Promise<CloudInvoice[]> {
	const invoices: Stripe.Invoice[] = [];
	for await (const invoice of getStripeClient().invoices.list({
		customer: stripeCustomerId,
		expand: ['data.discounts.promotion_code'],
		limit: 100,
	})) {
		invoices.push(invoice);
	}
	return invoices
		.filter((invoice) => !isCloudTrialPlaceholderInvoice(invoice))
		.map((invoice) => ({
			id: invoice.id,
			number: invoice.number,
			invoiceKind: isCreditTopUpInvoice(invoice)
				? 'credit_top_up'
				: invoice.total !== 0
					? 'subscription'
					: invoice.billing_reason === 'subscription_create' && invoice.subtotal === 0
						? 'trial'
						: 'no_charge',
			promotionCodes: invoicePromotionCodes(invoice),
			status: invoice.status,
			createdAt: new Date(invoice.created * 1_000),
			total: invoice.total,
			currency: invoice.currency,
			hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
			invoicePdf: invoice.invoice_pdf ?? null,
		}));
}

export async function getCloudUpcomingInvoice(stripeSubscriptionId: string): Promise<CloudUpcomingInvoice> {
	const invoice = await getStripeClient().invoices.createPreview({
		subscription: stripeSubscriptionId,
		expand: ['discounts.promotion_code'],
	});
	return {
		amountDue: invoice.amount_due,
		currency: invoice.currency,
		nextPaymentAt: new Date(invoice.period_start * 1_000),
		promotionCodes: invoicePromotionCodes(invoice),
	};
}

export async function listStripeInvoicesCreatedSince(createdSince: Date): Promise<StripeAccountInvoice[]> {
	const invoices: StripeAccountInvoice[] = [];
	for await (const invoice of getStripeClient().invoices.list({
		created: { gte: Math.floor(createdSince.getTime() / 1_000) },
		limit: 100,
	})) {
		if (isCloudTrialPlaceholderInvoice(invoice)) {
			continue;
		}
		invoices.push({
			id: invoice.id,
			number: invoice.number,
			stripeCustomerId: invoice.customer ? stripeCustomerId(invoice.customer) : null,
			status: invoice.status,
			billingReason: invoice.billing_reason,
			invoiceKind: isCreditTopUpInvoice(invoice) ? 'credit_top_up' : 'subscription',
			total: invoice.total,
			amountPaid: invoice.amount_paid,
			currency: invoice.currency,
			attemptCount: invoice.attempt_count,
			createdAt: new Date(invoice.created * 1_000),
			paidAt: stripeDate(invoice.status_transitions.paid_at ?? null),
			hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
		});
	}
	return invoices;
}

/** Monthly amounts are normalized from the plan interval and net of recurring coupons. */
export async function listCurrentCloudSubscriptions(): Promise<CloudSubscriptionRevenue[]> {
	const productId = configuredCloudProductId();
	const subscriptions: CloudSubscriptionRevenue[] = [];
	for (const status of ['active', 'past_due', 'trialing'] as const) {
		for await (const subscription of getStripeClient().subscriptions.list({
			status,
			expand: ['data.discounts.source.coupon'],
			limit: 100,
		})) {
			const item = cloudProductItem(subscription, productId);
			if (!item) {
				continue;
			}
			subscriptions.push({
				id: subscription.id,
				stripeCustomerId: stripeCustomerId(subscription.customer),
				status: subscription.status,
				currency: subscription.currency,
				monthlyAmount: await monthlyRecurringAmount(subscription, item),
			});
		}
	}
	return subscriptions;
}

export function stripeDashboardUrl(path: string): string {
	return `https://dashboard.stripe.com/${isStripeLiveMode() ? '' : 'test/'}${path}`;
}

export function isStripeLiveMode(): boolean {
	return /^[rs]k_live_/.test(env.STRIPE_SECRET_KEY ?? '');
}

export async function resumeCloudSubscription(input: {
	organizationId: string;
	stripeSubscriptionId: string;
	requestId: string;
}): Promise<Stripe.Subscription> {
	const subscription = await getCloudSubscription(input.stripeSubscriptionId);
	if (subscription.status !== 'paused') {
		throw new CloudSubscriptionResumeError('Only a paused subscription can be resumed');
	}

	if (
		!hasSubscriptionDefaultPaymentMethod(subscription) &&
		!(await hasCloudDefaultPaymentMethod(stripeCustomerId(subscription.customer)))
	) {
		throw new CloudSubscriptionResumeError('Add a payment method before resuming the subscription');
	}

	return getStripeClient().subscriptions.resume(
		subscription.id,
		{},
		{ idempotencyKey: `cloud-resume-v2:${input.organizationId}:${input.requestId}` },
	);
}

export async function updateCloudPaidSubscriptionTrialEnd(
	subscription: Stripe.Subscription,
	organizationId: string,
	trialEnd: Date,
): Promise<Stripe.Subscription> {
	if (cloudSubscriptionKind(subscription) !== 'paid-cloud') {
		throw new Error(`Stripe Subscription "${subscription.id}" is not a paid cloud Subscription`);
	}
	assertCloudSubscriptionOrganization(subscription, organizationId);
	return getStripeClient().subscriptions.update(
		subscription.id,
		{ proration_behavior: 'none', trial_end: stripeTimestamp(trialEnd) },
		{
			idempotencyKey: `cloud-paid-trial-end-v1:${organizationId}:${subscription.id}:${stripeTimestamp(trialEnd)}`,
		},
	);
}

export async function cancelCloudTrialPlaceholderSubscription(
	subscription: Stripe.Subscription,
	organizationId: string,
): Promise<Stripe.Subscription> {
	if (cloudSubscriptionKind(subscription) !== 'trial-placeholder') {
		throw new Error(`Stripe Subscription "${subscription.id}" is not a cloud trial placeholder`);
	}
	assertCloudSubscriptionOrganization(subscription, organizationId);
	return getStripeClient().subscriptions.cancel(
		subscription.id,
		{},
		{ idempotencyKey: `cloud-trial-placeholder-cancel-v1:${organizationId}:${subscription.id}` },
	);
}

export async function hasCloudDefaultPaymentMethod(stripeCustomerIdValue: string): Promise<boolean> {
	const customer = await getStripeClient().customers.retrieve(stripeCustomerIdValue);
	return !customer.deleted && Boolean(customer.invoice_settings.default_payment_method || customer.default_source);
}

export function cloudSubscriptionKind(subscription: Stripe.Subscription): CloudSubscriptionKind | null {
	const paidItem = cloudProductItem(subscription, configuredCloudProductId());
	const placeholderItem = cloudTrialPlaceholderItem(subscription);
	if (paidItem && placeholderItem) {
		throw new Error(`Stripe Subscription "${subscription.id}" mixes paid and trial placeholder Products`);
	}
	if (paidItem) {
		return 'paid-cloud';
	}
	return placeholderItem ? 'trial-placeholder' : null;
}

export async function listCloudSubscriptions(stripeCustomerIdValue: string): Promise<ClassifiedCloudSubscription[]> {
	const subscriptions: ClassifiedCloudSubscription[] = [];
	for await (const subscription of getStripeClient().subscriptions.list({
		customer: stripeCustomerIdValue,
		status: 'all',
		limit: 100,
	})) {
		const kind = cloudSubscriptionKind(subscription);
		if (kind) {
			subscriptions.push({ kind, subscription });
		}
	}
	return subscriptions;
}

export async function getCloudSubscription(stripeSubscriptionId: string): Promise<Stripe.Subscription> {
	const subscription = await findCloudSubscription(stripeSubscriptionId);
	if (!subscription) {
		throw new Error(`Stripe Subscription "${stripeSubscriptionId}" does not use the configured cloud Product`);
	}
	return subscription;
}

/** A subscription's currency never changes, so entries only need eviction to bound memory. */
export function getCloudSubscriptionCurrency(stripeSubscriptionId: string): Promise<string> {
	const cached = subscriptionCurrencyCache.get(stripeSubscriptionId);
	if (cached) {
		return cached;
	}
	if (subscriptionCurrencyCache.size >= SUBSCRIPTION_CURRENCY_CACHE_LIMIT) {
		subscriptionCurrencyCache.clear();
	}
	const currency = getCloudSubscription(stripeSubscriptionId).then((subscription) => subscription.currency);
	subscriptionCurrencyCache.set(stripeSubscriptionId, currency);
	currency.catch(() => {
		if (subscriptionCurrencyCache.get(stripeSubscriptionId) === currency) {
			subscriptionCurrencyCache.delete(stripeSubscriptionId);
		}
	});
	return currency;
}

export async function findCloudSubscription(stripeSubscriptionId: string): Promise<Stripe.Subscription | null> {
	const subscription = await getStripeClient().subscriptions.retrieve(stripeSubscriptionId);
	return hasProduct(subscription, configuredCloudProductId()) ? subscription : null;
}

export async function findManagedCloudSubscription(stripeSubscriptionId: string): Promise<Stripe.Subscription | null> {
	const subscription = await getStripeClient().subscriptions.retrieve(stripeSubscriptionId);
	return cloudSubscriptionKind(subscription) ? subscription : null;
}

export async function getCloudCheckoutSubscription(
	stripeCheckoutSessionId: string,
): Promise<{ session: Stripe.Checkout.Session; subscription: Stripe.Subscription }> {
	const session = await getStripeClient().checkout.sessions.retrieve(stripeCheckoutSessionId);
	if (!session.subscription) {
		throw new Error(`Stripe Checkout Session "${stripeCheckoutSessionId}" has no Subscription`);
	}
	const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
	return { session, subscription: await getCloudSubscription(subscriptionId) };
}

export async function getStripeEvent(stripeEventId: string): Promise<Stripe.Event> {
	return getStripeClient().events.retrieve(stripeEventId);
}

export async function getStripeCheckoutSession(stripeCheckoutSessionId: string): Promise<Stripe.Checkout.Session> {
	return getStripeClient().checkout.sessions.retrieve(stripeCheckoutSessionId);
}

export async function getStripeInvoice(stripeInvoiceId: string): Promise<Stripe.Invoice> {
	return getStripeClient().invoices.retrieve(stripeInvoiceId);
}

export async function getStripePaymentMethod(stripePaymentMethodId: string): Promise<Stripe.PaymentMethod> {
	return getStripeClient().paymentMethods.retrieve(stripePaymentMethodId);
}

export async function getStripePaymentIntent(stripePaymentIntentId: string): Promise<Stripe.PaymentIntent> {
	return getStripeClient().paymentIntents.retrieve(stripePaymentIntentId);
}

export async function getStripeCharge(stripeChargeId: string): Promise<Stripe.Charge> {
	return getStripeClient().charges.retrieve(stripeChargeId);
}

export async function getStripeDispute(stripeDisputeId: string): Promise<Stripe.Dispute> {
	return getStripeClient().disputes.retrieve(stripeDisputeId, { expand: ['charge'] });
}

export async function cloudSubscriptionProjection(subscription: Stripe.Subscription): Promise<SubscriptionProjection> {
	const billingStatus = subscription.status;
	if (!isBillingStatus(billingStatus)) {
		throw new Error(`Unsupported Stripe subscription status "${billingStatus}"`);
	}
	const kind = cloudSubscriptionKind(subscription);
	if (kind === 'trial-placeholder') {
		return cloudTrialPlaceholderProjection(subscription, billingStatus);
	}
	const item = cloudProductItem(subscription, configuredCloudProductId());
	if (!item) {
		throw new Error(`Stripe Subscription "${subscription.id}" has no cloud plan item`);
	}

	const trialEndsAt = stripeDate(subscription.trial_end);
	const currentPeriodStartsAt = stripeDate(item.current_period_start);
	const currentPeriodEndsAt = stripeDate(item.current_period_end);
	const cancellationEndsAt = stripeDate(subscription.cancel_at);
	const cancellationScheduled =
		billingStatus !== 'canceled' && (subscription.cancel_at_period_end || cancellationEndsAt !== null);
	const hasDefaultPaymentMethod =
		hasSubscriptionDefaultPaymentMethod(subscription) ||
		(await hasCloudDefaultPaymentMethod(stripeCustomerId(subscription.customer)));
	const plan = cloudBillingPlanDefinition(item.price);
	return {
		billingPlan: plan.key,
		billingStatus,
		stripeCustomerId: stripeCustomerId(subscription.customer),
		stripeSubscriptionId: subscription.id,
		stripePriceId: item.price.id,
		trialStartedAt: stripeDate(subscription.trial_start),
		trialEndsAt,
		currentPeriodStartsAt,
		currentPeriodEndsAt,
		cancellationScheduled,
		hasDefaultPaymentMethod,
		billingAccessEndsAt: cancellationScheduled
			? (cancellationEndsAt ?? (billingStatus === 'trialing' ? trialEndsAt : currentPeriodEndsAt))
			: billingStatus === 'trialing'
				? trialEndsAt
				: ['active', 'past_due'].includes(billingStatus)
					? currentPeriodEndsAt
					: null,
	};
}

async function cloudTrialPlaceholderProjection(
	subscription: Stripe.Subscription,
	billingStatus: BillingStatus,
): Promise<SubscriptionProjection> {
	const item = cloudTrialPlaceholderItem(subscription);
	if (!item) {
		throw new Error(`Stripe Subscription "${subscription.id}" has no trial placeholder item`);
	}
	const trialEndsAt = stripeDate(subscription.trial_end);
	const cancellationEndsAt = stripeDate(subscription.cancel_at);
	const cancellationScheduled =
		billingStatus !== 'canceled' && (subscription.cancel_at_period_end || cancellationEndsAt !== null);
	const billingAccessEndsAt =
		billingStatus === 'trialing' ? earlierStripeDate(trialEndsAt, cancellationEndsAt) : null;
	const hasDefaultPaymentMethod = await hasCloudDefaultPaymentMethod(stripeCustomerId(subscription.customer));
	return {
		billingPlan: null,
		billingStatus,
		stripeCustomerId: stripeCustomerId(subscription.customer),
		stripeSubscriptionId: subscription.id,
		stripePriceId: item.price.id,
		trialStartedAt: stripeDate(subscription.trial_start),
		trialEndsAt,
		currentPeriodStartsAt: stripeDate(item.current_period_start),
		currentPeriodEndsAt: stripeDate(item.current_period_end),
		cancellationScheduled,
		hasDefaultPaymentMethod,
		billingAccessEndsAt,
	};
}

export async function validateCloudBillingConfiguration(): Promise<void> {
	await Promise.all([getAvailableCloudPrices(), getCloudTrialPrice()]);
	const taxSettings = await getStripeClient().tax.settings.retrieve();
	if (taxSettings.status !== 'active') {
		const missingFields = taxSettings.status_details.pending?.missing_fields?.join(', ');
		throw new Error(`Stripe Tax must be active${missingFields ? `; missing: ${missingFields}` : ''}`);
	}
}

export async function getCloudPrice(billingInterval: CloudBillingInterval): Promise<CloudPrice> {
	const plan = CLOUD_BILLING_PLANS[billingInterval];
	const lookupKeyVariable =
		billingInterval === 'monthly'
			? 'STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY'
			: 'STRIPE_CLOUD_YEARLY_PRICE_LOOKUP_KEY';
	const lookupKey = env[lookupKeyVariable];
	if (!lookupKey) {
		throw new Error(`${lookupKeyVariable} is required when cloud billing is enabled`);
	}
	const productId = configuredCloudProductId();
	const cached = cloudPriceCache.get(billingInterval);

	if (cached?.lookupKey === lookupKey && cached.productId === productId && cached.expiresAt > Date.now()) {
		return cached.price;
	}

	const price = fetchCloudPrice(lookupKey, productId, plan);
	cloudPriceCache.set(billingInterval, {
		lookupKey,
		productId,
		expiresAt: Date.now() + CLOUD_PRICE_CACHE_TTL_MS,
		price,
	});
	try {
		return await price;
	} catch (error) {
		if (cloudPriceCache.get(billingInterval)?.price === price) {
			cloudPriceCache.delete(billingInterval);
		}
		throw error;
	}
}

async function getCloudTrialPrice(): Promise<CloudTrialPrice> {
	const lookupKey = env.STRIPE_CLOUD_TRIAL_PRICE_LOOKUP_KEY;
	if (!lookupKey) {
		throw new Error('STRIPE_CLOUD_TRIAL_PRICE_LOOKUP_KEY is required when cloud billing is enabled');
	}
	const productId = configuredCloudTrialProductId();
	if (productId === configuredCloudProductId()) {
		throw new Error('STRIPE_CLOUD_TRIAL_PRODUCT_ID must differ from STRIPE_CLOUD_PRODUCT_ID');
	}
	if (
		cloudTrialPriceCache?.lookupKey === lookupKey &&
		cloudTrialPriceCache.productId === productId &&
		cloudTrialPriceCache.expiresAt > Date.now()
	) {
		return cloudTrialPriceCache.price;
	}

	const price = fetchCloudTrialPrice(lookupKey, productId);
	cloudTrialPriceCache = {
		lookupKey,
		productId,
		expiresAt: Date.now() + CLOUD_PRICE_CACHE_TTL_MS,
		price,
	};
	try {
		return await price;
	} catch (error) {
		if (cloudTrialPriceCache?.price === price) {
			cloudTrialPriceCache = undefined;
		}
		throw error;
	}
}

async function fetchCloudTrialPrice(lookupKey: string, productId: string): Promise<CloudTrialPrice> {
	const [price] = (
		await getStripeClient().prices.list({
			active: true,
			expand: ['data.product'],
			lookup_keys: [lookupKey],
			limit: 1,
		})
	).data;

	if (!price) {
		throw new Error(`No active Stripe Price found for lookup key "${lookupKey}"`);
	}
	if (!isExpectedCloudTrialPrice(price) || price.product.id !== productId) {
		throw new Error(
			`Stripe Price "${price.id}" must belong to configured active trial Product "${productId}" and be a fixed $0 recurring licensed Price`,
		);
	}
	return price;
}

async function fetchCloudPrice(
	lookupKey: string,
	productId: string,
	plan: CloudBillingPlanDefinition,
): Promise<CloudPrice> {
	const [price] = (
		await getStripeClient().prices.list({
			active: true,
			expand: ['data.currency_options', 'data.product'],
			lookup_keys: [lookupKey],
			limit: 1,
		})
	).data;

	if (!price) {
		throw new Error(`No active Stripe Price found for lookup key "${lookupKey}"`);
	}
	if (!isExpectedCloudPrice(price, plan) || price.product.id !== productId) {
		throw new Error(
			`Stripe Price "${price.id}" must belong to configured active Product "${productId}" and be a fixed positive USD and EUR ${plan.interval}ly licensed Price`,
		);
	}

	return price;
}

export function __resetStripeForTesting(): void {
	stripeClient = undefined;
	cloudPriceCache.clear();
	cloudTrialPriceCache = undefined;
	subscriptionCurrencyCache.clear();
	priceCurrencyOptionsCache.clear();
}

export async function getCloudBillingPlans(
	stripePriceId?: string | null,
	currency: CloudBillingCurrency = 'usd',
	subscriptionCurrency?: string | null,
): Promise<{
	availablePlans: Record<CloudBillingInterval, CloudBillingPlan>;
	subscriptionPlan: CloudBillingPlan | null;
}> {
	const { monthly: monthlyPrice, yearly: yearlyPrice } = await getAvailableCloudPrices();
	const availablePlans = {
		monthly: cloudBillingPlan(monthlyPrice, currency),
		yearly: cloudBillingPlan(yearlyPrice, currency),
	};
	if (!stripePriceId) {
		return { availablePlans, subscriptionPlan: null };
	}
	const currentCurrency = subscriptionCurrency ?? currency;
	if (stripePriceId === monthlyPrice.id) {
		return { availablePlans, subscriptionPlan: cloudBillingPlan(monthlyPrice, currentCurrency) };
	}
	if (stripePriceId === yearlyPrice.id) {
		return { availablePlans, subscriptionPlan: cloudBillingPlan(yearlyPrice, currentCurrency) };
	}

	const subscriptionPrice = await getStripeClient().prices.retrieve(stripePriceId, {
		expand: ['currency_options'],
	});
	if (
		!isCloudRecurringPriceDetails(subscriptionPrice) ||
		stripeProductId(subscriptionPrice.product) !== configuredCloudProductId()
	) {
		throw new Error(`Stripe Price "${stripePriceId}" is not a valid historical cloud Price`);
	}
	return {
		availablePlans,
		subscriptionPlan: cloudBillingPlan(subscriptionPrice, subscriptionCurrency ?? subscriptionPrice.currency),
	};
}

export function getStripeClient(): Stripe {
	if (!isCloudBillingEnabled()) {
		throw new Error('Stripe is unavailable because cloud billing is disabled');
	}

	if (!env.STRIPE_SECRET_KEY) {
		throw new Error('STRIPE_SECRET_KEY is required when cloud billing is enabled');
	}

	stripeClient ??= new Stripe(env.STRIPE_SECRET_KEY, {
		apiVersion: STRIPE_API_VERSION,
		maxNetworkRetries: 2,
		timeout: 20_000,
	});

	return stripeClient;
}

function billingPageUrl(): string {
	return new URL('/settings/organization/billing', env.BETTER_AUTH_URL).toString();
}

function checkoutTrialMessage(trialEnd: Date): string {
	const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(trialEnd);
	return `Nothing is charged today. Your recurring price, including any promotion code discount, starts when your trial ends on ${date}.`;
}

function checkoutImmediateStartMessage(): string {
	return 'Not enough time remains to preserve your free trial in Checkout, so your subscription starts when you confirm. The recurring price shown, including any promotion code discount, is charged today.';
}

function stripeTimestamp(date: Date): number {
	return Math.floor(date.getTime() / 1_000);
}

async function reuseOrExpireOpenCheckoutSessions(
	input: {
		organizationId: string;
		stripeCustomerId: string;
		kind: 'initial' | 'resubscribe';
	},
	matches: (session: Stripe.Checkout.Session) => boolean,
): Promise<Stripe.Checkout.Session | undefined> {
	let reusableSession: Stripe.Checkout.Session | undefined;
	const supersededSessions: Stripe.Checkout.Session[] = [];
	for await (const session of getStripeClient().checkout.sessions.list({
		customer: input.stripeCustomerId,
		status: 'open',
		limit: 100,
	})) {
		if (!isOrganizationCheckoutSession(session, input)) {
			continue;
		}
		if (!reusableSession && matches(session)) {
			reusableSession = session;
		} else {
			supersededSessions.push(session);
		}
	}
	for (const session of supersededSessions) {
		await expireSupersededCheckoutSession(session, input.kind);
	}
	return reusableSession;
}

function isOrganizationCheckoutSession(
	session: Stripe.Checkout.Session,
	input: {
		organizationId: string;
		kind: 'initial' | 'resubscribe';
	},
): boolean {
	return (
		session.metadata?.[ORGANIZATION_METADATA_KEY] === input.organizationId &&
		session.metadata?.[CHECKOUT_KIND_METADATA_KEY] === input.kind &&
		isCloudBillingPlanKey(session.metadata?.[PLAN_METADATA_KEY])
	);
}

async function expireSupersededCheckoutSession(
	session: Stripe.Checkout.Session,
	kind: 'initial' | 'resubscribe',
): Promise<void> {
	try {
		await getStripeClient().checkout.sessions.expire(session.id);
	} catch (error) {
		let currentSession: Stripe.Checkout.Session;
		try {
			currentSession = await getStripeClient().checkout.sessions.retrieve(session.id);
		} catch {
			throw error;
		}
		if (currentSession.status === 'expired') {
			return;
		}
		if (currentSession.status === 'complete') {
			const message = 'A Stripe Checkout completed while the billing interval was changing';
			throw kind === 'initial'
				? new CloudInitialCheckoutUnavailableError(message)
				: new CloudSubscriptionUnavailableError(message);
		}
		throw error;
	}
}

async function getAvailableCloudPrices(): Promise<Record<CloudBillingInterval, CloudPrice>> {
	const [monthly, yearly] = await Promise.all([getCloudPrice('monthly'), getCloudPrice('yearly')]);
	return { monthly, yearly };
}

async function findCheckoutSession(
	stripeCustomerId: string,
	status: 'open' | 'expired',
	matches: (session: Stripe.Checkout.Session) => boolean,
): Promise<Stripe.Checkout.Session | undefined> {
	for await (const session of getStripeClient().checkout.sessions.list({
		customer: stripeCustomerId,
		status,
		limit: 100,
	})) {
		if (matches(session)) {
			return session;
		}
	}
	return undefined;
}

function isCreditTopUpInvoice(invoice: Pick<Stripe.Invoice, 'metadata'>): boolean {
	return invoice.metadata?.[CHECKOUT_KIND_METADATA_KEY] === CREDIT_TOP_UP_CHECKOUT_KIND;
}

function isCloudTrialPlaceholderInvoice(invoice: Pick<Stripe.Invoice, 'lines'>): boolean {
	const trialProductId = configuredCloudTrialProductId();
	return invoice.lines.data.some((line) => line.pricing?.price_details?.product === trialProductId);
}

function invoicePromotionCodes(invoice: Pick<Stripe.Invoice, 'discounts'>): string[] {
	return invoice.discounts.flatMap((discount) => {
		if (
			typeof discount === 'string' ||
			discount.promotion_code === null ||
			typeof discount.promotion_code !== 'object'
		) {
			return [];
		}
		return [discount.promotion_code.code];
	});
}

function hasProduct(subscription: Stripe.Subscription, productId: string): boolean {
	return cloudProductItem(subscription, productId) !== null;
}

function cloudProductItem(subscription: Stripe.Subscription, productId: string): CloudSubscriptionItem | null {
	return (
		subscription.items.data.find(
			(item): item is CloudSubscriptionItem =>
				stripeProductId(item.price.product) === productId && isCloudRecurringPriceDetails(item.price),
		) ?? null
	);
}

function cloudTrialPlaceholderItem(subscription: Stripe.Subscription): Stripe.SubscriptionItem | null {
	const productId = configuredCloudTrialProductId();
	const lookupKey = configuredCloudTrialPriceLookupKey();
	return (
		subscription.items.data.find(
			(item) =>
				item.price.lookup_key === lookupKey &&
				stripeProductId(item.price.product) === productId &&
				item.price.type === 'recurring' &&
				item.price.unit_amount === 0,
		) ?? null
	);
}

function configuredCloudProductId(): string {
	if (!env.STRIPE_CLOUD_PRODUCT_ID) {
		throw new Error('STRIPE_CLOUD_PRODUCT_ID is required when cloud billing is enabled');
	}
	return env.STRIPE_CLOUD_PRODUCT_ID;
}

function configuredCloudTrialProductId(): string {
	if (!env.STRIPE_CLOUD_TRIAL_PRODUCT_ID) {
		throw new Error('STRIPE_CLOUD_TRIAL_PRODUCT_ID is required when cloud billing is enabled');
	}
	return env.STRIPE_CLOUD_TRIAL_PRODUCT_ID;
}

function configuredCloudTrialPriceLookupKey(): string {
	if (!env.STRIPE_CLOUD_TRIAL_PRICE_LOOKUP_KEY) {
		throw new Error('STRIPE_CLOUD_TRIAL_PRICE_LOOKUP_KEY is required when cloud billing is enabled');
	}
	return env.STRIPE_CLOUD_TRIAL_PRICE_LOOKUP_KEY;
}

function assertCloudSubscriptionOrganization(subscription: Stripe.Subscription, organizationId: string): void {
	const metadataOrganizationId = subscription.metadata[ORGANIZATION_METADATA_KEY];
	if (metadataOrganizationId && metadataOrganizationId !== organizationId) {
		throw new Error(`Stripe Subscription "${subscription.id}" organization metadata does not match`);
	}
}

function stripeCustomerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer): string {
	return typeof customer === 'string' ? customer : customer.id;
}

function stripeProductId(product: string | Stripe.Product | Stripe.DeletedProduct): string {
	return typeof product === 'string' ? product : product.id;
}

function hasSubscriptionDefaultPaymentMethod(subscription: Stripe.Subscription): boolean {
	return Boolean(subscription.default_payment_method || subscription.default_source);
}

function stripeDate(value: number | null): Date | null {
	return value === null ? null : new Date(value * 1000);
}

function earlierStripeDate(first: Date | null, second: Date | null): Date | null {
	if (!first) {
		return second;
	}
	return second && second < first ? second : first;
}

function isBillingStatus(status: string): status is BillingStatus {
	return (BILLING_STATUSES as readonly string[]).includes(status);
}

function isExpectedCloudPrice(price: Stripe.Price, plan: CloudBillingPlanDefinition): price is CloudPrice {
	return (
		price.active &&
		typeof price.product !== 'string' &&
		!price.product.deleted &&
		price.product.active &&
		isCloudRecurringPriceDetails(price) &&
		price.recurring.interval === plan.interval &&
		price.recurring.interval_count === plan.intervalCount &&
		CLOUD_BILLING_CURRENCIES.every((currency) => cloudPriceAmount(price, currency) !== null)
	);
}

function isExpectedCloudTrialPrice(price: Stripe.Price): price is CloudTrialPrice {
	return (
		price.active &&
		typeof price.product !== 'string' &&
		!price.product.deleted &&
		price.product.active &&
		price.billing_scheme === 'per_unit' &&
		price.unit_amount === 0 &&
		price.type === 'recurring' &&
		price.recurring?.usage_type === 'licensed'
	);
}

function isCloudRecurringPriceDetails(price: Stripe.Price): price is CloudRecurringPriceDetails {
	return (
		price.billing_scheme === 'per_unit' &&
		typeof price.unit_amount === 'number' &&
		price.unit_amount > 0 &&
		price.type === 'recurring' &&
		price.recurring?.usage_type === 'licensed' &&
		findCloudBillingPlanDefinition(price) !== undefined
	);
}

function cloudBillingPlanDefinition(price: CloudRecurringPriceDetails): CloudBillingPlanDefinition {
	const plan = findCloudBillingPlanDefinition(price);
	if (!plan) {
		throw new Error(`Stripe Price "${price.id}" has an unsupported billing interval`);
	}
	return plan;
}

function findCloudBillingPlanDefinition(price: Stripe.Price): CloudBillingPlanDefinition | undefined {
	const recurring = price.recurring;
	if (!recurring) {
		return undefined;
	}
	return Object.values(CLOUD_BILLING_PLANS).find(
		(plan) => plan.interval === recurring.interval && plan.intervalCount === recurring.interval_count,
	);
}

function cloudBillingPlan(price: CloudRecurringPriceDetails, currency: string): CloudBillingPlan {
	const amount = cloudPriceAmount(price, currency);
	if (amount === null) {
		throw new Error(`Stripe Price "${price.id}" does not support ${currency.toUpperCase()}`);
	}
	return {
		...cloudBillingPlanDefinition(price),
		amount,
		currency,
	};
}

function cloudPriceAmount(price: CloudRecurringPriceDetails, currency: string): number | null {
	const amount = price.currency === currency ? price.unit_amount : price.currency_options?.[currency]?.unit_amount;
	return typeof amount === 'number' && amount > 0 ? amount : null;
}

async function monthlyRecurringAmount(subscription: Stripe.Subscription, item: CloudSubscriptionItem): Promise<number> {
	const unitAmount = await subscriptionUnitAmount(item.price, subscription.currency);
	const amount = applyRecurringDiscounts(unitAmount * (item.quantity ?? 1), subscription);
	const months = (item.price.recurring.interval === 'year' ? 12 : 1) * item.price.recurring.interval_count;
	return Math.round(amount / months);
}

async function subscriptionUnitAmount(price: CloudRecurringPriceDetails, currency: string): Promise<number> {
	if (price.currency === currency) {
		return price.unit_amount;
	}
	const priceWithCurrencyOptions = await getPriceWithCurrencyOptions(price.id);
	return priceWithCurrencyOptions.currency_options?.[currency]?.unit_amount ?? 0;
}

function getPriceWithCurrencyOptions(priceId: string): Promise<Stripe.Price> {
	const cached = priceCurrencyOptionsCache.get(priceId);
	if (cached) {
		return cached;
	}
	const price = getStripeClient().prices.retrieve(priceId, { expand: ['currency_options'] });
	priceCurrencyOptionsCache.set(priceId, price);
	price.catch(() => priceCurrencyOptionsCache.delete(priceId));
	return price;
}

function applyRecurringDiscounts(amount: number, subscription: Stripe.Subscription): number {
	const now = Date.now() / 1_000;
	return subscription.discounts.reduce((discounted, discount) => {
		if (typeof discount === 'string' || (discount.end !== null && discount.end <= now)) {
			return discounted;
		}
		const coupon = discount.source.coupon;
		if (!coupon || typeof coupon === 'string' || coupon.duration === 'once') {
			return discounted;
		}
		if (coupon.percent_off !== null) {
			return discounted * (1 - coupon.percent_off / 100);
		}
		const amountOff =
			coupon.currency === subscription.currency
				? coupon.amount_off
				: coupon.currency_options?.[subscription.currency]?.amount_off;
		return Math.max(0, discounted - (amountOff ?? 0));
	}, amount);
}
