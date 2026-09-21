import Stripe from 'stripe';

import { env } from '../env';
import { CLOUD_MONTHLY_PLAN } from '../types/billing';

const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-08-26.dahlia';

type CloudMonthlyPrice = Stripe.Price & {
	recurring: Stripe.Price.Recurring;
	unit_amount: number;
};

let stripeClient: Stripe | undefined;

export async function getCloudMonthlyPrice(): Promise<CloudMonthlyPrice> {
	const lookupKey = env.STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY;
	if (!lookupKey) {
		throw new Error('STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY is required when cloud billing is enabled');
	}

	const [price] = (
		await getStripeClient().prices.list({
			active: true,
			lookup_keys: [lookupKey],
			limit: 1,
		})
	).data;

	if (!price) {
		throw new Error(`No active Stripe Price found for lookup key "${lookupKey}"`);
	}
	if (!isExpectedCloudMonthlyPrice(price)) {
		throw new Error(`Stripe Price "${price.id}" must be a fixed EUR 2,000 monthly licensed Price`);
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

export function isCloudBillingEnabled(): boolean {
	return env.NAO_MODE === 'cloud' && env.CLOUD_BILLING_ENABLED;
}

function isExpectedCloudMonthlyPrice(price: Stripe.Price): price is CloudMonthlyPrice {
	return (
		price.active &&
		price.billing_scheme === 'per_unit' &&
		price.currency === CLOUD_MONTHLY_PLAN.currency &&
		price.unit_amount === CLOUD_MONTHLY_PLAN.amount &&
		price.type === 'recurring' &&
		price.recurring?.interval === CLOUD_MONTHLY_PLAN.interval &&
		price.recurring.interval_count === CLOUD_MONTHLY_PLAN.intervalCount &&
		price.recurring.usage_type === 'licensed'
	);
}
