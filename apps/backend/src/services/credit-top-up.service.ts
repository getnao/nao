import type Stripe from 'stripe';

import { env } from '../env';
import { calculateCreditTopUp, CREDIT_TOP_UP_CURRENCY } from '../types/billing';
import { withKeyedLock } from '../utils/keyed-lock';
import { stripeId } from '../utils/stripe';
import { getStripeClient } from './stripe.service';

const ORGANIZATION_METADATA_KEY = 'nao_org_id';
const CHECKOUT_KIND_METADATA_KEY = 'nao_checkout_kind';
const CREDIT_AMOUNT_METADATA_KEY = 'nao_credit_amount_cents';
const WALLET_AMOUNT_METADATA_KEY = 'nao_wallet_amount_micro_usd';
const PLATFORM_FEE_METADATA_KEY = 'nao_platform_fee_cents';
const INITIATING_USER_METADATA_KEY = 'nao_initiating_user_id';
const CREDIT_TOP_UP_CHECKOUT_KIND = 'credit_top_up';
const CREDIT_TOP_UP_CHECKOUT_TTL_SECONDS = 60 * 60;
const MICRO_USD_PER_CENT = 10_000;

export interface CreditTopUpPurchase {
	checkoutSessionId: string;
	paymentIntentId: string;
	invoiceId: string | null;
	organizationId: string;
	initiatingUserId: string;
	stripeCustomerId: string;
	creditAmountCents: number;
	platformFeeCents: number;
	walletAmountMicroUsd: number;
	taxAmountCents: number;
	totalAmountCents: number;
}

export async function createCreditTopUpCheckoutSession(input: {
	creditAmountCents: number;
	organizationId: string;
	stripeCustomerId: string;
	initiatingUserId: string;
	requestId: string;
}): Promise<string> {
	return withKeyedLock(`credit-top-up-checkout:${input.organizationId}`, () =>
		createLockedCreditTopUpCheckoutSession(input),
	);
}

export function isCreditTopUpCheckoutSession(session: Stripe.Checkout.Session): boolean {
	return session.mode === 'payment' && session.metadata?.[CHECKOUT_KIND_METADATA_KEY] === CREDIT_TOP_UP_CHECKOUT_KIND;
}

export function isCreditTopUpPaymentIntent(paymentIntent: Stripe.PaymentIntent): boolean {
	return paymentIntent.metadata?.[CHECKOUT_KIND_METADATA_KEY] === CREDIT_TOP_UP_CHECKOUT_KIND;
}

export async function getCreditTopUpPurchase(stripeCheckoutSessionId: string): Promise<CreditTopUpPurchase> {
	const session = await getStripeClient().checkout.sessions.retrieve(stripeCheckoutSessionId, {
		expand: ['line_items.data.price.product', 'payment_intent', 'invoice'],
	});
	if (!isCreditTopUpCheckoutSession(session) || session.payment_status !== 'paid') {
		throw new Error(`Stripe Checkout Session "${session.id}" is not a paid credit top-up`);
	}
	if (session.currency !== CREDIT_TOP_UP_CURRENCY) {
		throw new Error(`Stripe Checkout Session "${session.id}" must use USD`);
	}
	const organizationId = session.metadata?.[ORGANIZATION_METADATA_KEY] ?? session.client_reference_id;
	const initiatingUserId = session.metadata?.[INITIATING_USER_METADATA_KEY];
	if (!organizationId || !initiatingUserId) {
		throw new Error(`Stripe Checkout Session "${session.id}" has incomplete credit top-up metadata`);
	}
	const creditAmountCents = metadataInteger(session, CREDIT_AMOUNT_METADATA_KEY);
	const walletAmountMicroUsd = metadataInteger(session, WALLET_AMOUNT_METADATA_KEY);
	const platformFeeCents = metadataInteger(session, PLATFORM_FEE_METADATA_KEY);
	const subtotalAmountCents = creditAmountCents + platformFeeCents;
	if (
		walletAmountMicroUsd !== creditAmountCents * MICRO_USD_PER_CENT ||
		session.amount_subtotal !== subtotalAmountCents ||
		session.total_details?.amount_discount !== 0
	) {
		throw new Error(`Stripe Checkout Session "${session.id}" has invalid credit top-up amounts`);
	}
	validateCreditTopUpLineItems(session, creditAmountCents, platformFeeCents);
	const taxAmountCents = session.total_details?.amount_tax ?? 0;
	if (session.amount_total !== subtotalAmountCents + taxAmountCents) {
		throw new Error(`Stripe Checkout Session "${session.id}" has an unexpected total`);
	}
	return {
		checkoutSessionId: session.id,
		paymentIntentId: stripeId(session.payment_intent),
		invoiceId: session.invoice ? stripeId(session.invoice) : null,
		organizationId,
		initiatingUserId,
		stripeCustomerId: stripeId(session.customer),
		creditAmountCents,
		platformFeeCents,
		walletAmountMicroUsd,
		taxAmountCents,
		totalAmountCents: session.amount_total,
	};
}

export async function validateCreditTopUpConfiguration(): Promise<void> {
	const creditProductId = configuredCreditProductId();
	const platformFeeProductId = configuredCreditPlatformFeeProductId();
	if (creditProductId === platformFeeProductId) {
		throw new Error('Stripe credit and platform-fee Products must be different');
	}
	const products = await Promise.all([
		getStripeClient().products.retrieve(creditProductId),
		getStripeClient().products.retrieve(platformFeeProductId),
	]);
	if (products.some((product) => product.deleted || !product.active)) {
		throw new Error('Stripe credit and platform-fee Products must be active');
	}
}

async function createLockedCreditTopUpCheckoutSession(input: {
	creditAmountCents: number;
	organizationId: string;
	stripeCustomerId: string;
	initiatingUserId: string;
	requestId: string;
}): Promise<string> {
	const topUp = calculateCreditTopUp(input.creditAmountCents);
	const metadata = {
		[ORGANIZATION_METADATA_KEY]: input.organizationId,
		[CHECKOUT_KIND_METADATA_KEY]: CREDIT_TOP_UP_CHECKOUT_KIND,
		[CREDIT_AMOUNT_METADATA_KEY]: String(topUp.creditAmountCents),
		[WALLET_AMOUNT_METADATA_KEY]: String(topUp.walletAmountMicroUsd),
		[PLATFORM_FEE_METADATA_KEY]: String(topUp.platformFeeCents),
		[INITIATING_USER_METADATA_KEY]: input.initiatingUserId,
	};
	const existingSession = await reuseOrExpireOpenCreditTopUpSessions(
		input.stripeCustomerId,
		input.organizationId,
		metadata,
	);
	if (existingSession?.url) {
		return existingSession.url;
	}
	const creditsUrl = new URL('/settings/organization/billing', env.BETTER_AUTH_URL);
	const session = await getStripeClient().checkout.sessions.create(
		{
			mode: 'payment',
			currency: CREDIT_TOP_UP_CURRENCY,
			customer: input.stripeCustomerId,
			customer_update: { address: 'auto', name: 'auto' },
			automatic_tax: { enabled: true },
			tax_id_collection: { enabled: true },
			billing_address_collection: 'required',
			client_reference_id: input.organizationId,
			line_items: [
				{
					price_data: {
						currency: CREDIT_TOP_UP_CURRENCY,
						product: configuredCreditProductId(),
						unit_amount: topUp.creditAmountCents,
					},
					quantity: 1,
				},
				{
					price_data: {
						currency: CREDIT_TOP_UP_CURRENCY,
						product: configuredCreditPlatformFeeProductId(),
						unit_amount: topUp.platformFeeCents,
					},
					quantity: 1,
				},
			],
			allow_promotion_codes: false,
			payment_method_types: ['card'],
			invoice_creation: { enabled: true, invoice_data: { metadata } },
			metadata,
			payment_intent_data: { metadata },
			custom_text: {
				submit: {
					message: 'Your organization receives the credit amount shown. The separate nao platform fee is 5%.',
				},
			},
			success_url: `${creditsUrl.toString()}?creditCheckout={CHECKOUT_SESSION_ID}`,
			cancel_url: `${creditsUrl.toString()}?creditCheckout=canceled`,
			expires_at: Math.floor(Date.now() / 1_000) + CREDIT_TOP_UP_CHECKOUT_TTL_SECONDS,
		},
		{ idempotencyKey: `credit-top-up-v1:${input.organizationId}:${input.requestId}` },
	);
	if (!session.url) {
		throw new Error('Stripe did not return a Checkout URL');
	}
	return session.url;
}

async function reuseOrExpireOpenCreditTopUpSessions(
	stripeCustomerId: string,
	organizationId: string,
	metadata: Record<string, string>,
): Promise<Stripe.Checkout.Session | undefined> {
	let reusableSession: Stripe.Checkout.Session | undefined;
	for await (const session of getStripeClient().checkout.sessions.list({
		customer: stripeCustomerId,
		status: 'open',
		limit: 100,
	})) {
		if (
			!isCreditTopUpCheckoutSession(session) ||
			session.metadata?.[ORGANIZATION_METADATA_KEY] !== organizationId
		) {
			continue;
		}
		const matches = Object.entries(metadata).every(([key, value]) => session.metadata?.[key] === value);
		if (!reusableSession && matches && session.url) {
			reusableSession = session;
			continue;
		}
		await expireOpenCreditTopUpSession(session);
	}
	return reusableSession;
}

async function expireOpenCreditTopUpSession(session: Stripe.Checkout.Session): Promise<void> {
	try {
		await getStripeClient().checkout.sessions.expire(session.id);
	} catch (error) {
		const currentSession = await getStripeClient().checkout.sessions.retrieve(session.id);
		if (currentSession.status === 'expired') {
			return;
		}
		if (currentSession.status === 'complete') {
			throw new Error('A credit top-up completed while another Checkout was starting');
		}
		throw error;
	}
}

function validateCreditTopUpLineItems(
	session: Stripe.Checkout.Session,
	creditAmountCents: number,
	platformFeeCents: number,
): void {
	const items = session.line_items?.data ?? [];
	const matches = (productId: string, amount: number) =>
		items.filter(
			(item) =>
				item.quantity === 1 &&
				item.currency === CREDIT_TOP_UP_CURRENCY &&
				item.amount_subtotal === amount &&
				item.price !== null &&
				stripeProductId(item.price.product) === productId,
		).length === 1;
	if (
		items.length !== 2 ||
		!matches(configuredCreditProductId(), creditAmountCents) ||
		!matches(configuredCreditPlatformFeeProductId(), platformFeeCents)
	) {
		throw new Error(`Stripe Checkout Session "${session.id}" has invalid credit top-up line items`);
	}
}

function metadataInteger(session: Stripe.Checkout.Session, key: string): number {
	const value = Number(session.metadata?.[key]);
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`Stripe Checkout Session "${session.id}" has invalid ${key} metadata`);
	}
	return value;
}

function configuredCreditProductId(): string {
	if (!env.STRIPE_CREDIT_PRODUCT_ID) {
		throw new Error('STRIPE_CREDIT_PRODUCT_ID is required when cloud billing is enabled');
	}
	return env.STRIPE_CREDIT_PRODUCT_ID;
}

function configuredCreditPlatformFeeProductId(): string {
	if (!env.STRIPE_CREDIT_PLATFORM_FEE_PRODUCT_ID) {
		throw new Error('STRIPE_CREDIT_PLATFORM_FEE_PRODUCT_ID is required when cloud billing is enabled');
	}
	return env.STRIPE_CREDIT_PLATFORM_FEE_PRODUCT_ID;
}

function stripeProductId(product: string | Stripe.Product | Stripe.DeletedProduct): string {
	return typeof product === 'string' ? product : product.id;
}
