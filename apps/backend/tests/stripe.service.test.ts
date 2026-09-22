import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stripeMocks = vi.hoisted(() => ({
	construct: vi.fn(),
	createCheckoutSession: vi.fn(),
	createCustomer: vi.fn(),
	createPortalSession: vi.fn(),
	listCheckoutSessions: vi.fn(),
	listInvoices: vi.fn(),
	listPrices: vi.fn(),
	listSubscriptions: vi.fn(),
	resumeSubscription: vi.fn(),
	retrieveCustomer: vi.fn(),
	retrieveSubscription: vi.fn(),
}));

vi.mock('stripe', () => ({
	default: class {
		constructor() {
			stripeMocks.construct();
		}

		billingPortal = { sessions: { create: stripeMocks.createPortalSession } };
		checkout = {
			sessions: {
				create: stripeMocks.createCheckoutSession,
				list: stripeMocks.listCheckoutSessions,
			},
		};
		customers = {
			create: stripeMocks.createCustomer,
			retrieve: stripeMocks.retrieveCustomer,
		};
		invoices = { list: stripeMocks.listInvoices };
		prices = { list: stripeMocks.listPrices };
		subscriptions = {
			list: stripeMocks.listSubscriptions,
			resume: stripeMocks.resumeSubscription,
			retrieve: stripeMocks.retrieveSubscription,
		};
	},
}));

import type Stripe from 'stripe';

import { __reloadEnvForTesting } from '../src/env';
import {
	cloudSubscriptionProjection,
	createCloudCheckoutSession,
	createCloudCustomer,
	createCloudPaymentMethodSession,
	createCloudPortalSession,
	createCloudResubscribeSession,
	getCloudMonthlyPrice,
	getStripeClient,
	listCloudInvoices,
	resumeCloudSubscription,
} from '../src/services/stripe.service';

let originalEnv: typeof process.env;

beforeEach(() => {
	originalEnv = { ...process.env };
	process.env.BETTER_AUTH_URL = 'https://cloud.getnao.io';
	process.env.CLOUD_BILLING_ENABLED = 'true';
	process.env.NAO_MODE = 'cloud';
	process.env.STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY = 'nao_cloud_monthly_v2';
	process.env.STRIPE_SECRET_KEY = 'sk_test_example';
	process.env.STRIPE_WEBHOOK_SECRET = 'whsec_example';
	__reloadEnvForTesting();
	vi.clearAllMocks();
	stripeMocks.listPrices.mockResolvedValue({ data: [cloudMonthlyPrice()] });
	stripeMocks.listCheckoutSessions.mockResolvedValue({ data: [] });
	stripeMocks.listSubscriptions.mockResolvedValue({ data: [] });
});

afterEach(() => {
	process.env = originalEnv;
	__reloadEnvForTesting();
});

describe('getCloudMonthlyPrice', () => {
	it('resolves the configured active Price', async () => {
		const expectedPrice = cloudMonthlyPrice();
		stripeMocks.listPrices.mockResolvedValue({ data: [expectedPrice] });

		await expect(getCloudMonthlyPrice()).resolves.toBe(expectedPrice);
		expect(stripeMocks.listPrices).toHaveBeenCalledWith({
			active: true,
			expand: ['data.product'],
			lookup_keys: ['nao_cloud_monthly_v2'],
			limit: 1,
		});
	});

	it('rejects a missing Price', async () => {
		stripeMocks.listPrices.mockResolvedValue({ data: [] });

		await expect(getCloudMonthlyPrice()).rejects.toThrow(
			'No active Stripe Price found for lookup key "nao_cloud_monthly_v2"',
		);
	});

	it.each([
		['inactive', { active: false }],
		['inactive product', { product: cloudProduct({ active: false }) }],
		['tiered', { billing_scheme: 'tiered' }],
		['different currency', { currency: 'usd' }],
		['different amount', { unit_amount: 100_000 }],
		['one-time', { type: 'one_time', recurring: null }],
		['yearly', { recurring: recurring({ interval: 'year' }) }],
		['multi-month', { recurring: recurring({ interval_count: 2 }) }],
		['metered', { recurring: recurring({ usage_type: 'metered' }) }],
	] satisfies Array<[string, Partial<Stripe.Price>]>)('rejects an %s Price', async (_name, overrides) => {
		stripeMocks.listPrices.mockResolvedValue({ data: [cloudMonthlyPrice(overrides)] });

		await expect(getCloudMonthlyPrice()).rejects.toThrow(
			'Stripe Price "price_cloud_monthly" must belong to an active Product and be a fixed EUR 2,000 monthly licensed Price',
		);
	});

	it.each([
		['cloud billing is disabled', { CLOUD_BILLING_ENABLED: 'false', NAO_MODE: 'cloud' }],
		['nao is self-hosted', { CLOUD_BILLING_ENABLED: 'true', NAO_MODE: 'self-hosted' }],
	])('does not construct Stripe when %s', (_name, overrides) => {
		Object.assign(process.env, overrides);
		__reloadEnvForTesting();

		expect(() => getStripeClient()).toThrow('Stripe is unavailable because cloud billing is disabled');
		expect(stripeMocks.construct).not.toHaveBeenCalled();
		expect(stripeMocks.listPrices).not.toHaveBeenCalled();
	});
});

describe('cloud Checkout', () => {
	it('creates a cardless 14-day Checkout Session from server-owned values', async () => {
		stripeMocks.createCheckoutSession.mockResolvedValue({
			url: 'https://checkout.stripe.com/session',
		});

		await expect(
			createCloudCheckoutSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
			}),
		).resolves.toBe('https://checkout.stripe.com/session');

		expect(stripeMocks.createCheckoutSession).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: 'subscription',
				customer: 'cus_cloud',
				line_items: [{ price: 'price_cloud_monthly', quantity: 1 }],
				payment_method_collection: 'if_required',
				subscription_data: expect.objectContaining({
					trial_period_days: 14,
					trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
				}),
				success_url: 'https://cloud.getnao.io/settings/organization/billing?checkout=success',
				cancel_url: 'https://cloud.getnao.io/settings/organization/billing?checkout=canceled',
			}),
			{ idempotencyKey: 'cloud-checkout-trial-v2:org-id' },
		);
	});

	it('reuses the organization open Checkout Session', async () => {
		stripeMocks.listCheckoutSessions.mockResolvedValue({
			data: [
				{
					mode: 'subscription',
					metadata: { nao_org_id: 'org-id', nao_plan_key: 'cloud_monthly_v2' },
					url: 'https://checkout.stripe.com/existing',
				},
			],
		});

		await expect(
			createCloudCheckoutSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
			}),
		).resolves.toBe('https://checkout.stripe.com/existing');
		expect(stripeMocks.createCheckoutSession).not.toHaveBeenCalled();
	});

	it('rejects another trial when Stripe already has the cloud subscription', async () => {
		stripeMocks.listSubscriptions.mockResolvedValue({ data: [cloudSubscription()] });

		await expect(
			createCloudCheckoutSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
			}),
		).rejects.toThrow('already used its cloud trial');
		expect(stripeMocks.createCheckoutSession).not.toHaveBeenCalled();
	});

	it('creates a paid Checkout Session after a canceled subscription without another trial', async () => {
		stripeMocks.listSubscriptions.mockResolvedValue({
			data: [cloudSubscription({ status: 'canceled' })],
		});
		stripeMocks.createCheckoutSession.mockResolvedValue({
			url: 'https://checkout.stripe.com/resubscribe',
		});

		await expect(
			createCloudResubscribeSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				requestId: 'request-id',
			}),
		).resolves.toBe('https://checkout.stripe.com/resubscribe');

		expect(stripeMocks.createCheckoutSession).toHaveBeenCalledWith(
			expect.objectContaining({
				customer: 'cus_cloud',
				payment_method_collection: 'always',
				subscription_data: {
					metadata: { nao_org_id: 'org-id', nao_plan_key: 'cloud_monthly_v2' },
				},
				success_url: 'https://cloud.getnao.io/settings/organization/billing?checkout=subscribed',
			}),
			{ idempotencyKey: 'cloud-checkout-subscription-v2:org-id:request-id' },
		);
	});

	it('rejects a new Checkout Session while a current subscription exists', async () => {
		stripeMocks.listSubscriptions.mockResolvedValue({ data: [cloudSubscription({ status: 'active' })] });

		await expect(
			createCloudResubscribeSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				requestId: 'request-id',
			}),
		).rejects.toThrow('already has a current subscription');
		expect(stripeMocks.createCheckoutSession).not.toHaveBeenCalled();
	});

	it('creates one idempotent organization Customer', async () => {
		stripeMocks.createCustomer.mockResolvedValue({ id: 'cus_cloud' });

		await createCloudCustomer({
			organizationId: 'org-id',
			organizationName: 'Test Organization',
			adminEmail: 'admin@example.com',
		});

		expect(stripeMocks.createCustomer).toHaveBeenCalledWith(
			{
				name: 'Test Organization',
				email: 'admin@example.com',
				metadata: { nao_org_id: 'org-id' },
			},
			{ idempotencyKey: 'cloud-customer-v2:org-id' },
		);
	});
});

describe('cloud subscription projection', () => {
	it('projects a future cancel_at as a scheduled cancellation', async () => {
		const cancellationEndsAt = 1_799_500_000;

		await expect(
			cloudSubscriptionProjection(
				cloudSubscription({
					status: 'active',
					cancel_at: cancellationEndsAt,
					cancel_at_period_end: false,
				}),
			),
		).resolves.toMatchObject({
			cancelAtPeriodEnd: true,
			billingAccessEndsAt: new Date(cancellationEndsAt * 1_000),
		});
	});
});

describe('cloud billing recovery', () => {
	it('lists a safe invoice history for the organization Customer', async () => {
		stripeMocks.listInvoices.mockResolvedValue({
			data: [
				{
					id: 'in_cloud',
					number: 'NAO-0001',
					status: 'paid',
					created: 1_795_000_000,
					total: 200_000,
					currency: 'eur',
					hosted_invoice_url: 'https://invoice.stripe.com/in_cloud',
					invoice_pdf: 'https://pay.stripe.com/invoice/in_cloud/pdf',
				},
			],
		});

		await expect(listCloudInvoices('cus_cloud')).resolves.toEqual([
			{
				id: 'in_cloud',
				number: 'NAO-0001',
				status: 'paid',
				createdAt: new Date(1_795_000_000_000),
				total: 200_000,
				currency: 'eur',
				hostedInvoiceUrl: 'https://invoice.stripe.com/in_cloud',
				invoicePdf: 'https://pay.stripe.com/invoice/in_cloud/pdf',
			},
		]);
		expect(stripeMocks.listInvoices).toHaveBeenCalledWith({ customer: 'cus_cloud', limit: 100 });
	});

	it('creates a Customer Portal Session with a trusted return URL', async () => {
		stripeMocks.createPortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/session' });

		await expect(
			createCloudPortalSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				requestId: 'request-id',
			}),
		).resolves.toBe('https://billing.stripe.com/session');

		expect(stripeMocks.createPortalSession).toHaveBeenCalledWith(
			{
				customer: 'cus_cloud',
				return_url: 'https://cloud.getnao.io/settings/organization/billing?portal=returned',
			},
			{ idempotencyKey: 'cloud-portal-v2:org-id:request-id' },
		);
	});

	it('creates a payment-method management Portal Session', async () => {
		stripeMocks.createPortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/payment-method' });

		await expect(
			createCloudPaymentMethodSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				requestId: 'request-id',
			}),
		).resolves.toBe('https://billing.stripe.com/payment-method');

		expect(stripeMocks.createPortalSession).toHaveBeenCalledWith(
			{
				customer: 'cus_cloud',
				return_url: 'https://cloud.getnao.io/settings/organization/billing?portal=returned',
				flow_data: {
					type: 'payment_method_update',
					after_completion: {
						type: 'redirect',
						redirect: {
							return_url: 'https://cloud.getnao.io/settings/organization/billing?portal=returned',
						},
					},
				},
			},
			{ idempotencyKey: 'cloud-payment-method-v2:org-id:request-id' },
		);
	});

	it('refuses to resume a paused subscription without a payment method', async () => {
		stripeMocks.retrieveSubscription.mockResolvedValue(cloudSubscription({ status: 'paused' }));
		stripeMocks.retrieveCustomer.mockResolvedValue({
			deleted: false,
			default_source: null,
			invoice_settings: { default_payment_method: null },
		});

		await expect(
			resumeCloudSubscription({
				organizationId: 'org-id',
				stripeSubscriptionId: 'sub_cloud',
				requestId: 'request-id',
			}),
		).rejects.toThrow('Add a payment method before resuming');
		expect(stripeMocks.resumeSubscription).not.toHaveBeenCalled();
	});
});

function cloudMonthlyPrice(overrides: Partial<Stripe.Price> = {}): Stripe.Price {
	return {
		active: true,
		billing_scheme: 'per_unit',
		currency: 'eur',
		id: 'price_cloud_monthly',
		object: 'price',
		product: cloudProduct(),
		recurring: recurring(),
		type: 'recurring',
		unit_amount: 200_000,
		...overrides,
	} as Stripe.Price;
}

function cloudProduct(overrides: Partial<Stripe.Product> = {}): Stripe.Product {
	return {
		active: true,
		id: 'prod_cloud',
		object: 'product',
		...overrides,
	} as Stripe.Product;
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

function cloudSubscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
	return {
		cancel_at_period_end: false,
		customer: 'cus_cloud',
		id: 'sub_cloud',
		items: {
			data: [
				{
					current_period_end: 1_800_000_000,
					price: cloudMonthlyPrice(),
					quantity: 1,
				},
			],
		},
		metadata: { nao_org_id: 'org-id' },
		status: 'trialing',
		trial_end: 1_800_000_000,
		trial_start: 1_799_000_000,
		...overrides,
	} as Stripe.Subscription;
}
