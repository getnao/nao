import Stripe from 'stripe';

import { env, isCloudBillingEnabled } from '../env';
import type { SubscriptionProjection } from '../queries/billing.queries';
import {
	type BillingStatus,
	CLOUD_MONTHLY_PLAN,
	type CloudBillingPlan,
	isTerminalBillingStatus,
} from '../types/billing';

const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-08-26.dahlia';
const CLOUD_MONTHLY_PRICE_CACHE_TTL_MS = 5 * 60 * 1000;
const ORGANIZATION_METADATA_KEY = 'nao_org_id';
const PLAN_METADATA_KEY = 'nao_plan_key';
const CHECKOUT_KIND_METADATA_KEY = 'nao_checkout_kind';

type CloudMonthlyPriceDetails = Stripe.Price & {
	recurring: Stripe.Price.Recurring;
	unit_amount: number;
};

type CloudMonthlyPrice = CloudMonthlyPriceDetails & {
	product: Stripe.Product;
};

interface CloudInvoice {
	id: string;
	number: string | null;
	invoiceKind: 'trial' | 'subscription' | 'no_charge';
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

export class CloudInitialCheckoutUnavailableError extends Error {}

export class CloudSubscriptionUnavailableError extends Error {}

export class CloudSubscriptionResumeError extends Error {}

let stripeClient: Stripe | undefined;
let cloudMonthlyPriceCache:
	| { lookupKey: string; productId: string; expiresAt: number; price: Promise<CloudMonthlyPrice> }
	| undefined;

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

export async function createCloudCheckoutSession(input: {
	organizationId: string;
	stripeCustomerId: string;
	trialDays: number;
}): Promise<string> {
	if ((await listCloudSubscriptions(input.stripeCustomerId)).length > 0) {
		throw new CloudInitialCheckoutUnavailableError(
			'This organization already has cloud subscription history; use resubscribe instead',
		);
	}
	return createSubscriptionCheckoutSession({
		...input,
		kind: 'initial',
		operationKey: `trial-${input.trialDays}`,
	});
}

export async function createCloudResubscribeSession(input: {
	organizationId: string;
	stripeCustomerId: string;
	allowMissingHistory?: boolean;
}): Promise<string> {
	const subscriptions = await listCloudSubscriptions(input.stripeCustomerId);
	if (subscriptions.some((subscription) => !isTerminalBillingStatus(subscription.status))) {
		throw new CloudSubscriptionUnavailableError('This organization already has a current subscription');
	}
	const latestSubscription = [...subscriptions].sort((left, right) => right.created - left.created)[0];
	if (!latestSubscription && !input.allowMissingHistory) {
		throw new CloudSubscriptionUnavailableError('This organization has no subscription history');
	}
	return createSubscriptionCheckoutSession({
		...input,
		kind: 'resubscribe',
		operationKey: latestSubscription?.id ?? 'missing-subscription',
	});
}

async function createSubscriptionCheckoutSession(input: {
	organizationId: string;
	stripeCustomerId: string;
	kind: 'initial' | 'resubscribe';
	operationKey: string;
	trialDays?: number;
}): Promise<string> {
	const trialMessage = input.trialDays === undefined ? null : checkoutTrialMessage(input.trialDays);
	const matchesCheckout = (session: Stripe.Checkout.Session) =>
		session.mode === 'subscription' &&
		session.allow_promotion_codes === true &&
		session.metadata?.[ORGANIZATION_METADATA_KEY] === input.organizationId &&
		session.metadata?.[PLAN_METADATA_KEY] === CLOUD_MONTHLY_PLAN.key &&
		session.metadata?.[CHECKOUT_KIND_METADATA_KEY] === input.kind &&
		(trialMessage === null || session.custom_text?.submit?.message === trialMessage);
	const existingSession = (
		await getStripeClient().checkout.sessions.list({
			customer: input.stripeCustomerId,
			status: 'open',
			limit: 100,
		})
	).data.find(matchesCheckout);
	if (existingSession?.url) {
		return existingSession.url;
	}
	const latestExpiredSession = (
		await getStripeClient().checkout.sessions.list({
			customer: input.stripeCustomerId,
			status: 'expired',
			limit: 100,
		})
	).data.find(matchesCheckout);

	const price = await getCloudMonthlyPrice();
	const billingUrl = billingPageUrl();
	const session = await getStripeClient().checkout.sessions.create(
		{
			mode: 'subscription',
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
				[PLAN_METADATA_KEY]: CLOUD_MONTHLY_PLAN.key,
				[CHECKOUT_KIND_METADATA_KEY]: input.kind,
			},
			subscription_data: {
				metadata: {
					[ORGANIZATION_METADATA_KEY]: input.organizationId,
					[PLAN_METADATA_KEY]: CLOUD_MONTHLY_PLAN.key,
				},
				...(input.trialDays !== undefined
					? {
							trial_period_days: input.trialDays,
							trial_settings: { end_behavior: { missing_payment_method: 'pause' as const } },
						}
					: {}),
			},
			success_url: `${billingUrl}?checkout=${input.kind === 'initial' ? 'success' : 'subscribed'}`,
			cancel_url: `${billingUrl}?checkout=canceled`,
		},
		{
			idempotencyKey: `cloud-checkout-${input.kind}-v6:${input.organizationId}:${input.operationKey}${latestExpiredSession ? `:${latestExpiredSession.id}` : ''}`,
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
	return invoices.map((invoice) => ({
		id: invoice.id,
		number: invoice.number,
		invoiceKind:
			invoice.total !== 0
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
		nextPaymentAt: new Date(invoice.period_end * 1_000),
		promotionCodes: invoicePromotionCodes(invoice),
	};
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

export async function hasCloudDefaultPaymentMethod(stripeCustomerIdValue: string): Promise<boolean> {
	const customer = await getStripeClient().customers.retrieve(stripeCustomerIdValue);
	return !customer.deleted && Boolean(customer.invoice_settings.default_payment_method || customer.default_source);
}

export async function listCloudSubscriptions(stripeCustomerIdValue: string): Promise<Stripe.Subscription[]> {
	const productId = configuredCloudProductId();
	const subscriptions: Stripe.Subscription[] = [];
	for await (const subscription of getStripeClient().subscriptions.list({
		customer: stripeCustomerIdValue,
		status: 'all',
		limit: 100,
	})) {
		if (hasProduct(subscription, productId)) {
			subscriptions.push(subscription);
		}
	}
	return subscriptions;
}

export async function getCloudSubscription(stripeSubscriptionId: string): Promise<Stripe.Subscription> {
	const subscription = await getStripeClient().subscriptions.retrieve(stripeSubscriptionId);
	if (!hasProduct(subscription, configuredCloudProductId())) {
		throw new Error(`Stripe Subscription "${stripeSubscriptionId}" does not use the configured cloud Product`);
	}
	return subscription;
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

export async function cloudSubscriptionProjection(subscription: Stripe.Subscription): Promise<SubscriptionProjection> {
	if (!isBillingStatus(subscription.status)) {
		throw new Error(`Unsupported Stripe subscription status "${subscription.status}"`);
	}
	const item = cloudProductItem(subscription, configuredCloudProductId());
	if (!item) {
		throw new Error(`Stripe Subscription "${subscription.id}" has no cloud plan item`);
	}

	const trialEndsAt = stripeDate(subscription.trial_end);
	const currentPeriodEndsAt = stripeDate(item.current_period_end);
	const cancellationEndsAt = stripeDate(subscription.cancel_at);
	const cancellationScheduled =
		subscription.status !== 'canceled' && (subscription.cancel_at_period_end || cancellationEndsAt !== null);
	const hasDefaultPaymentMethod =
		hasSubscriptionDefaultPaymentMethod(subscription) ||
		(await hasCloudDefaultPaymentMethod(stripeCustomerId(subscription.customer)));
	return {
		billingPlan: CLOUD_MONTHLY_PLAN.key,
		billingStatus: subscription.status,
		stripeCustomerId: stripeCustomerId(subscription.customer),
		stripeSubscriptionId: subscription.id,
		stripePriceId: item.price.id,
		trialStartedAt: stripeDate(subscription.trial_start),
		trialEndsAt,
		currentPeriodEndsAt,
		cancellationScheduled,
		hasDefaultPaymentMethod,
		billingAccessEndsAt: cancellationScheduled
			? (cancellationEndsAt ?? (subscription.status === 'trialing' ? trialEndsAt : currentPeriodEndsAt))
			: subscription.status === 'trialing'
				? trialEndsAt
				: ['active', 'past_due'].includes(subscription.status)
					? currentPeriodEndsAt
					: null,
	};
}

export async function getCloudMonthlyPrice(): Promise<CloudMonthlyPrice> {
	const lookupKey = env.STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY;
	if (!lookupKey) {
		throw new Error('STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY is required when cloud billing is enabled');
	}
	const productId = configuredCloudProductId();

	if (
		cloudMonthlyPriceCache?.lookupKey === lookupKey &&
		cloudMonthlyPriceCache.productId === productId &&
		cloudMonthlyPriceCache.expiresAt > Date.now()
	) {
		return cloudMonthlyPriceCache.price;
	}

	const price = fetchCloudMonthlyPrice(lookupKey, productId);
	cloudMonthlyPriceCache = {
		lookupKey,
		productId,
		expiresAt: Date.now() + CLOUD_MONTHLY_PRICE_CACHE_TTL_MS,
		price,
	};
	try {
		return await price;
	} catch (error) {
		if (cloudMonthlyPriceCache?.price === price) {
			cloudMonthlyPriceCache = undefined;
		}
		throw error;
	}
}

async function fetchCloudMonthlyPrice(lookupKey: string, productId: string): Promise<CloudMonthlyPrice> {
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
	if (!isExpectedCloudMonthlyPrice(price) || price.product.id !== productId) {
		throw new Error(
			`Stripe Price "${price.id}" must belong to configured active Product "${productId}" and be a fixed positive ${CLOUD_MONTHLY_PLAN.currency.toUpperCase()} monthly licensed Price`,
		);
	}

	return price;
}

export function __resetStripeForTesting(): void {
	stripeClient = undefined;
	cloudMonthlyPriceCache = undefined;
}

export async function getCloudBillingPlans(
	stripePriceId?: string | null,
): Promise<{ availablePlan: CloudBillingPlan; subscriptionPlan: CloudBillingPlan | null }> {
	const availablePrice = await getCloudMonthlyPrice();
	const availablePlan = cloudBillingPlan(availablePrice);
	if (!stripePriceId) {
		return { availablePlan, subscriptionPlan: null };
	}
	if (stripePriceId === availablePrice.id) {
		return { availablePlan, subscriptionPlan: availablePlan };
	}

	const subscriptionPrice = await getStripeClient().prices.retrieve(stripePriceId);
	if (
		!isCloudMonthlyPriceDetails(subscriptionPrice) ||
		stripeProductId(subscriptionPrice.product) !== configuredCloudProductId()
	) {
		throw new Error(`Stripe Price "${stripePriceId}" is not a valid historical cloud Price`);
	}
	return { availablePlan, subscriptionPlan: cloudBillingPlan(subscriptionPrice) };
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

function checkoutTrialMessage(trialDays: number): string {
	return `Nothing is charged today. Your ${trialDays}-day free trial starts when you confirm. The recurring price shown, including any promotion code discount, starts after the trial.`;
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

function cloudProductItem(subscription: Stripe.Subscription, productId: string): Stripe.SubscriptionItem | null {
	return subscription.items.data.find((item) => stripeProductId(item.price.product) === productId) ?? null;
}

function configuredCloudProductId(): string {
	if (!env.STRIPE_CLOUD_PRODUCT_ID) {
		throw new Error('STRIPE_CLOUD_PRODUCT_ID is required when cloud billing is enabled');
	}
	return env.STRIPE_CLOUD_PRODUCT_ID;
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

function isBillingStatus(status: string): status is BillingStatus {
	return [
		'trialing',
		'active',
		'past_due',
		'unpaid',
		'canceled',
		'paused',
		'incomplete',
		'incomplete_expired',
	].includes(status);
}

function isExpectedCloudMonthlyPrice(price: Stripe.Price): price is CloudMonthlyPrice {
	return (
		price.active &&
		typeof price.product !== 'string' &&
		!price.product.deleted &&
		price.product.active &&
		price.currency === CLOUD_MONTHLY_PLAN.currency &&
		isCloudMonthlyPriceDetails(price)
	);
}

function isCloudMonthlyPriceDetails(price: Stripe.Price): price is CloudMonthlyPriceDetails {
	return (
		price.billing_scheme === 'per_unit' &&
		typeof price.unit_amount === 'number' &&
		price.unit_amount > 0 &&
		price.type === 'recurring' &&
		price.recurring?.interval === CLOUD_MONTHLY_PLAN.interval &&
		price.recurring.interval_count === CLOUD_MONTHLY_PLAN.intervalCount &&
		price.recurring.usage_type === 'licensed'
	);
}

function cloudBillingPlan(price: CloudMonthlyPriceDetails): CloudBillingPlan {
	return {
		...CLOUD_MONTHLY_PLAN,
		amount: price.unit_amount,
		currency: price.currency,
	};
}
