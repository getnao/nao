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
const CHECKOUT_KIND_METADATA_KEY = 'nao_checkout_kind';

type CloudRecurringPriceDetails = Stripe.Price & {
	recurring: Stripe.Price.Recurring;
	unit_amount: number;
};

type CloudPrice = CloudRecurringPriceDetails & {
	product: Stripe.Product;
};

type CloudSubscriptionItem = Stripe.SubscriptionItem & {
	price: CloudRecurringPriceDetails;
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
const cloudPriceCache = new Map<
	CloudBillingInterval,
	{ lookupKey: string; productId: string; expiresAt: number; price: Promise<CloudPrice> }
>();
const subscriptionCurrencyCache = new Map<string, Promise<string>>();

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
	billingInterval: CloudBillingInterval;
	currency?: CloudBillingCurrency;
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
		currency: input.currency ?? 'usd',
		kind: 'initial',
		operationKey: `trial-${input.trialDays}`,
	});
}

export async function createCloudResubscribeSession(input: {
	billingInterval: CloudBillingInterval;
	currency?: CloudBillingCurrency;
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
	trialDays?: number;
}): Promise<string> {
	const plan = CLOUD_BILLING_PLANS[input.billingInterval];
	const trialMessage = input.trialDays === undefined ? null : checkoutTrialMessage(input.trialDays);
	const matchesCheckout = (session: Stripe.Checkout.Session) =>
		session.mode === 'subscription' &&
		session.currency === input.currency &&
		session.allow_promotion_codes === true &&
		session.metadata?.[ORGANIZATION_METADATA_KEY] === input.organizationId &&
		session.metadata?.[PLAN_METADATA_KEY] === plan.key &&
		session.metadata?.[CHECKOUT_KIND_METADATA_KEY] === input.kind &&
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
			},
			subscription_data: {
				metadata: {
					[ORGANIZATION_METADATA_KEY]: input.organizationId,
					[PLAN_METADATA_KEY]: plan.key,
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
			idempotencyKey: `cloud-checkout-${input.kind}-v11:${input.organizationId}:${plan.key}:${input.currency}:${input.operationKey}${latestExpiredSession ? `:${latestExpiredSession.id}` : ''}`,
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
		nextPaymentAt: new Date(invoice.period_start * 1_000),
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

export async function cloudSubscriptionProjection(subscription: Stripe.Subscription): Promise<SubscriptionProjection> {
	if (!isBillingStatus(subscription.status)) {
		throw new Error(`Unsupported Stripe subscription status "${subscription.status}"`);
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
		subscription.status !== 'canceled' && (subscription.cancel_at_period_end || cancellationEndsAt !== null);
	const hasDefaultPaymentMethod =
		hasSubscriptionDefaultPaymentMethod(subscription) ||
		(await hasCloudDefaultPaymentMethod(stripeCustomerId(subscription.customer)));
	const plan = cloudBillingPlanDefinition(item.price);
	return {
		billingPlan: plan.key,
		billingStatus: subscription.status,
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
			? (cancellationEndsAt ?? (subscription.status === 'trialing' ? trialEndsAt : currentPeriodEndsAt))
			: subscription.status === 'trialing'
				? trialEndsAt
				: ['active', 'past_due'].includes(subscription.status)
					? currentPeriodEndsAt
					: null,
	};
}

export async function validateCloudBillingConfiguration(): Promise<void> {
	await getAvailableCloudPrices();
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
	subscriptionCurrencyCache.clear();
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

function checkoutTrialMessage(trialDays: number): string {
	return `Nothing is charged today. Your ${trialDays}-day free trial starts when you confirm. The recurring price shown, including any promotion code discount, starts after the trial.`;
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
