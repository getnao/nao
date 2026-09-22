import Stripe from 'stripe';

import { env, isCloudBillingEnabled } from '../env';
import { BillingStatus, CLOUD_MONTHLY_PLAN } from '../types/billing';

const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-08-26.dahlia';
const ORGANIZATION_METADATA_KEY = 'nao_org_id';
const PLAN_METADATA_KEY = 'nao_plan_key';
const CHECKOUT_KIND_METADATA_KEY = 'nao_checkout_kind';

type CloudMonthlyPrice = Stripe.Price & {
	product: Stripe.Product;
	recurring: Stripe.Price.Recurring;
	unit_amount: number;
};

export interface CloudSubscriptionProjection {
	billingPlan: typeof CLOUD_MONTHLY_PLAN.key;
	billingStatus: BillingStatus;
	stripeCustomerId: string;
	stripeSubscriptionId: string;
	stripePriceId: string;
	trialStartedAt: Date | null;
	trialEndsAt: Date | null;
	currentPeriodEndsAt: Date | null;
	cancelAtPeriodEnd: boolean;
	billingAccessEndsAt: Date | null;
}

export interface CloudInvoice {
	id: string;
	number: string | null;
	status: Stripe.Invoice.Status | null;
	createdAt: Date;
	total: number;
	currency: string;
	hostedInvoiceUrl: string | null;
	invoicePdf: string | null;
}

export class CloudTrialUnavailableError extends Error {}

export class CloudSubscriptionUnavailableError extends Error {}

export class CloudSubscriptionResumeError extends Error {}

let stripeClient: Stripe | undefined;

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
}): Promise<string> {
	if ((await findCloudSubscriptions(input.stripeCustomerId)).length > 0) {
		throw new CloudTrialUnavailableError('This organization has already used its cloud trial');
	}
	return createSubscriptionCheckoutSession({ ...input, kind: 'trial' });
}

export async function createCloudResubscribeSession(input: {
	organizationId: string;
	stripeCustomerId: string;
	requestId: string;
}): Promise<string> {
	const subscriptions = await findCloudSubscriptions(input.stripeCustomerId);
	if (subscriptions.some((subscription) => !isTerminalSubscription(subscription))) {
		throw new CloudSubscriptionUnavailableError('This organization already has a current subscription');
	}
	return createSubscriptionCheckoutSession({ ...input, kind: 'subscription' });
}

async function createSubscriptionCheckoutSession(input: {
	organizationId: string;
	stripeCustomerId: string;
	kind: 'trial' | 'subscription';
	requestId?: string;
}): Promise<string> {
	const existingSession = (
		await getStripeClient().checkout.sessions.list({
			customer: input.stripeCustomerId,
			status: 'open',
			limit: 100,
		})
	).data.find(
		(session) =>
			session.mode === 'subscription' &&
			session.metadata?.[ORGANIZATION_METADATA_KEY] === input.organizationId &&
			session.metadata?.[PLAN_METADATA_KEY] === CLOUD_MONTHLY_PLAN.key &&
			(input.kind === 'trial'
				? !session.metadata?.[CHECKOUT_KIND_METADATA_KEY] ||
					session.metadata[CHECKOUT_KIND_METADATA_KEY] === input.kind
				: session.metadata?.[CHECKOUT_KIND_METADATA_KEY] === input.kind),
	);
	if (existingSession?.url) {
		return existingSession.url;
	}

	const price = await getCloudMonthlyPrice();
	const billingUrl = billingPageUrl();
	const session = await getStripeClient().checkout.sessions.create(
		{
			mode: 'subscription',
			customer: input.stripeCustomerId,
			customer_update: { address: 'auto', name: 'auto' },
			client_reference_id: input.organizationId,
			line_items: [{ price: price.id, quantity: 1 }],
			payment_method_collection: input.kind === 'trial' ? 'if_required' : 'always',
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
				...(input.kind === 'trial'
					? {
							trial_period_days: CLOUD_MONTHLY_PLAN.trialDays,
							trial_settings: { end_behavior: { missing_payment_method: 'pause' as const } },
						}
					: {}),
			},
			success_url: `${billingUrl}?checkout=${input.kind === 'trial' ? 'success' : 'subscribed'}`,
			cancel_url: `${billingUrl}?checkout=canceled`,
		},
		{
			idempotencyKey:
				input.kind === 'trial'
					? `cloud-checkout-trial-v2:${input.organizationId}`
					: `cloud-checkout-subscription-v2:${input.organizationId}:${input.requestId}`,
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
	const invoices = await getStripeClient().invoices.list({
		customer: stripeCustomerId,
		limit: 100,
	});
	return invoices.data.map((invoice) => ({
		id: invoice.id,
		number: invoice.number,
		status: invoice.status,
		createdAt: new Date(invoice.created * 1_000),
		total: invoice.total,
		currency: invoice.currency,
		hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
		invoicePdf: invoice.invoice_pdf ?? null,
	}));
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

	const customerId = stripeCustomerId(subscription.customer);
	const customer = await getStripeClient().customers.retrieve(customerId);
	if (
		customer.deleted ||
		(!subscription.default_payment_method &&
			!subscription.default_source &&
			!customer.invoice_settings.default_payment_method &&
			!customer.default_source)
	) {
		throw new CloudSubscriptionResumeError('Add a payment method before resuming the subscription');
	}

	return getStripeClient().subscriptions.resume(
		subscription.id,
		{},
		{ idempotencyKey: `cloud-resume-v2:${input.organizationId}:${input.requestId}` },
	);
}

export async function findCloudSubscription(stripeCustomerIdValue: string): Promise<Stripe.Subscription | null> {
	return (await findCloudSubscriptions(stripeCustomerIdValue))[0] ?? null;
}

async function findCloudSubscriptions(stripeCustomerIdValue: string): Promise<Stripe.Subscription[]> {
	const price = await getCloudMonthlyPrice();
	const subscriptions = await getStripeClient().subscriptions.list({
		customer: stripeCustomerIdValue,
		status: 'all',
		limit: 100,
	});
	return subscriptions.data.filter((subscription) => hasPrice(subscription, price.id));
}

export async function getCloudSubscription(stripeSubscriptionId: string): Promise<Stripe.Subscription> {
	const [price, subscription] = await Promise.all([
		getCloudMonthlyPrice(),
		getStripeClient().subscriptions.retrieve(stripeSubscriptionId),
	]);
	if (!hasPrice(subscription, price.id)) {
		throw new Error(`Stripe Subscription "${stripeSubscriptionId}" does not use the configured cloud Price`);
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

export async function cloudSubscriptionProjection(
	subscription: Stripe.Subscription,
): Promise<CloudSubscriptionProjection> {
	if (!isBillingStatus(subscription.status)) {
		throw new Error(`Unsupported Stripe subscription status "${subscription.status}"`);
	}
	const price = await getCloudMonthlyPrice();
	const item = subscription.items.data.find((candidate) => candidate.price.id === price.id);
	if (!item) {
		throw new Error(`Stripe Subscription "${subscription.id}" has no cloud plan item`);
	}

	const trialEndsAt = stripeDate(subscription.trial_end);
	const currentPeriodEndsAt = stripeDate(item.current_period_end);
	const cancellationEndsAt = stripeDate(subscription.cancel_at);
	const cancellationScheduled =
		subscription.status !== 'canceled' && (subscription.cancel_at_period_end || cancellationEndsAt !== null);
	return {
		billingPlan: CLOUD_MONTHLY_PLAN.key,
		billingStatus: subscription.status,
		stripeCustomerId: stripeCustomerId(subscription.customer),
		stripeSubscriptionId: subscription.id,
		stripePriceId: item.price.id,
		trialStartedAt: stripeDate(subscription.trial_start),
		trialEndsAt,
		currentPeriodEndsAt,
		cancelAtPeriodEnd: cancellationScheduled,
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
	if (!isExpectedCloudMonthlyPrice(price)) {
		throw new Error(
			`Stripe Price "${price.id}" must belong to an active Product and be a fixed EUR 2,000 monthly licensed Price`,
		);
	}

	return price;
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

function hasPrice(subscription: Stripe.Subscription, priceId: string): boolean {
	return subscription.items.data.some((item) => item.price.id === priceId && item.quantity === 1);
}

function isTerminalSubscription(subscription: Stripe.Subscription): boolean {
	return subscription.status === 'canceled' || subscription.status === 'incomplete_expired';
}

function stripeCustomerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer): string {
	return typeof customer === 'string' ? customer : customer.id;
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
		price.billing_scheme === 'per_unit' &&
		price.currency === CLOUD_MONTHLY_PLAN.currency &&
		typeof price.product !== 'string' &&
		!price.product.deleted &&
		price.product.active &&
		price.unit_amount === CLOUD_MONTHLY_PLAN.amount &&
		price.type === 'recurring' &&
		price.recurring?.interval === CLOUD_MONTHLY_PLAN.interval &&
		price.recurring.interval_count === CLOUD_MONTHLY_PLAN.intervalCount &&
		price.recurring.usage_type === 'licensed'
	);
}
