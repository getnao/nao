import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listPrices = vi.hoisted(() => vi.fn());

vi.mock('stripe', () => ({
	default: class {
		prices = { list: listPrices };
	},
}));

import type Stripe from 'stripe';

import { __reloadEnvForTesting } from '../src/env';
import { getCloudMonthlyPrice } from '../src/services/stripe.service';

describe('getCloudMonthlyPrice', () => {
	let originalEnv: typeof process.env;

	beforeEach(() => {
		originalEnv = { ...process.env };
		process.env.CLOUD_BILLING_ENABLED = 'true';
		process.env.NAO_MODE = 'cloud';
		process.env.STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY = 'nao_cloud_monthly_v1';
		process.env.STRIPE_SECRET_KEY = 'sk_test_example';
		__reloadEnvForTesting();
		listPrices.mockReset();
	});

	afterEach(() => {
		process.env = originalEnv;
		__reloadEnvForTesting();
	});

	it('resolves the configured active Price', async () => {
		const expectedPrice = cloudMonthlyPrice();
		listPrices.mockResolvedValue({ data: [expectedPrice] });

		await expect(getCloudMonthlyPrice()).resolves.toBe(expectedPrice);
		expect(listPrices).toHaveBeenCalledWith({
			active: true,
			lookup_keys: ['nao_cloud_monthly_v1'],
			limit: 1,
		});
	});

	it('rejects a missing Price', async () => {
		listPrices.mockResolvedValue({ data: [] });

		await expect(getCloudMonthlyPrice()).rejects.toThrow(
			'No active Stripe Price found for lookup key "nao_cloud_monthly_v1"',
		);
	});

	it.each([
		['inactive', { active: false }],
		['tiered', { billing_scheme: 'tiered' }],
		['different currency', { currency: 'usd' }],
		['different amount', { unit_amount: 100_000 }],
		['one-time', { type: 'one_time', recurring: null }],
		['yearly', { recurring: recurring({ interval: 'year' }) }],
		['multi-month', { recurring: recurring({ interval_count: 2 }) }],
		['metered', { recurring: recurring({ usage_type: 'metered' }) }],
	] satisfies Array<[string, Partial<Stripe.Price>]>)('rejects an %s Price', async (_name, overrides) => {
		listPrices.mockResolvedValue({ data: [cloudMonthlyPrice(overrides)] });

		await expect(getCloudMonthlyPrice()).rejects.toThrow(
			'Stripe Price "price_cloud_monthly" must be a fixed EUR 2,000 monthly licensed Price',
		);
	});
});

function cloudMonthlyPrice(overrides: Partial<Stripe.Price> = {}): Stripe.Price {
	return {
		active: true,
		billing_scheme: 'per_unit',
		currency: 'eur',
		id: 'price_cloud_monthly',
		object: 'price',
		recurring: recurring(),
		type: 'recurring',
		unit_amount: 200_000,
		...overrides,
	} as Stripe.Price;
}

function recurring(overrides: Partial<Stripe.Price.Recurring> = {}): Stripe.Price.Recurring {
	return {
		interval: 'month',
		interval_count: 1,
		meter: null,
		trial_period_days: null,
		usage_type: 'licensed',
		...overrides,
	};
}
