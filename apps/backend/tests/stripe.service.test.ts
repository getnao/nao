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
	retrievePrice: vi.fn(),
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
		prices = {
			list: stripeMocks.listPrices,
			retrieve: stripeMocks.retrievePrice,
		};
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
	getCloudBillingPlans,
	getCloudMonthlyPrice,
	getStripeClient,
	listCloudInvoices,
	listCloudSubscriptions,
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
	stripeMocks.retrieveCustomer.mockResolvedValue({
		deleted: false,
		default_source: null,
		invoice_settings: { default_payment_method: null },
	});
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

	it('accepts a replacement Price with a new positive amount', async () => {
		const replacementPrice = cloudMonthlyPrice({ unit_amount: 250_000 });
		stripeMocks.listPrices.mockResolvedValue({ data: [replacementPrice] });

		await expect(getCloudMonthlyPrice()).resolves.toBe(replacementPrice);
	});

	it.each([
		['inactive', { active: false }],
		['inactive product', { product: cloudProduct({ active: false }) }],
		['tiered', { billing_scheme: 'tiered' }],
		['different currency', { currency: 'usd' }],
		['zero amount', { unit_amount: 0 }],
		['one-time', { type: 'one_time', recurring: null }],
		['yearly', { recurring: recurring({ interval: 'year' }) }],
		['multi-month', { recurring: recurring({ interval_count: 2 }) }],
		['metered', { recurring: recurring({ usage_type: 'metered' }) }],
	] satisfies Array<[string, Partial<Stripe.Price>]>)('rejects an %s Price', async (_name, overrides) => {
		stripeMocks.listPrices.mockResolvedValue({ data: [cloudMonthlyPrice(overrides)] });

		await expect(getCloudMonthlyPrice()).rejects.toThrow(
			'Stripe Price "price_cloud_monthly" must belong to an active Product and be a fixed positive EUR monthly licensed Price',
		);
	});

	it("returns an existing subscription's historical Price separately from the current offer", async () => {
		stripeMocks.listPrices.mockResolvedValue({
			data: [cloudMonthlyPrice({ unit_amount: 250_000 })],
		});
		stripeMocks.retrievePrice.mockResolvedValue(
			cloudMonthlyPrice({
				id: 'price_legacy',
				active: false,
				product: 'prod_cloud',
				unit_amount: 200_000,
			}),
		);

		await expect(getCloudBillingPlans('price_legacy')).resolves.toMatchObject({
			availablePlan: { amount: 250_000 },
			subscriptionPlan: { amount: 200_000 },
		});
		expect(stripeMocks.retrievePrice).toHaveBeenCalledWith('price_legacy');
	});

	it('rejects a historical Price from another Product', async () => {
		stripeMocks.retrievePrice.mockResolvedValue(cloudMonthlyPrice({ id: 'price_other', product: 'prod_other' }));

		await expect(getCloudBillingPlans('price_other')).rejects.toThrow(
			'Stripe Price "price_other" is not a valid historical cloud Price',
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
		const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
		stripeMocks.createCheckoutSession.mockResolvedValue({
			url: 'https://checkout.stripe.com/session',
		});

		await expect(
			createCloudCheckoutSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				trialEndsAt,
			}),
		).resolves.toBe('https://checkout.stripe.com/session');

		expect(stripeMocks.createCheckoutSession).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: 'subscription',
				customer: 'cus_cloud',
				line_items: [{ price: 'price_cloud_monthly', quantity: 1 }],
				payment_method_collection: 'if_required',
				metadata: {
					nao_org_id: 'org-id',
					nao_plan_key: 'cloud_monthly_v2',
					nao_checkout_kind: 'initial',
				},
				subscription_data: expect.objectContaining({
					trial_end: Math.floor(trialEndsAt.getTime() / 1000),
					trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
				}),
				success_url: 'https://cloud.getnao.io/settings/organization/billing?checkout=success',
				cancel_url: 'https://cloud.getnao.io/settings/organization/billing?checkout=canceled',
			}),
			{ idempotencyKey: `cloud-checkout-initial-v4:org-id:${trialEndsAt.getTime()}` },
		);
	});

	it('creates a zero-due Checkout before starting a new trial', async () => {
		stripeMocks.createCheckoutSession.mockResolvedValue({
			url: 'https://checkout.stripe.com/trial',
		});

		await expect(
			createCloudCheckoutSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				trialEndsAt: null,
				trialDays: 14,
			}),
		).resolves.toBe('https://checkout.stripe.com/trial');

		expect(stripeMocks.createCheckoutSession).toHaveBeenCalledWith(
			expect.objectContaining({
				line_items: [{ price: 'price_cloud_monthly', quantity: 1 }],
				payment_method_collection: 'if_required',
				subscription_data: {
					metadata: { nao_org_id: 'org-id', nao_plan_key: 'cloud_monthly_v2' },
					trial_period_days: 14,
					trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
				},
			}),
			{ idempotencyKey: 'cloud-checkout-initial-v4:org-id:trial-14' },
		);
	});

	it.each([
		['less than 48 hours remain', 48 * 60 * 60 * 1000 - 1],
		['the local trial has expired', -1],
	])('charges immediately when %s', async (_label, offsetMs) => {
		stripeMocks.createCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.com/session' });

		await createCloudCheckoutSession({
			organizationId: 'org-id',
			stripeCustomerId: 'cus_cloud',
			trialEndsAt: new Date(Date.now() + offsetMs),
		});

		expect(stripeMocks.createCheckoutSession).toHaveBeenCalledWith(
			expect.objectContaining({
				payment_method_collection: 'always',
				subscription_data: {
					metadata: { nao_org_id: 'org-id', nao_plan_key: 'cloud_monthly_v2' },
				},
			}),
			expect.anything(),
		);
	});

	it('reuses a legacy initial Checkout Session', async () => {
		stripeMocks.listCheckoutSessions.mockResolvedValue({
			data: [
				{
					mode: 'subscription',
					metadata: {
						nao_org_id: 'org-id',
						nao_plan_key: 'cloud_monthly_v2',
						nao_checkout_kind: 'trial',
					},
					url: 'https://checkout.stripe.com/existing',
				},
			],
		});

		await expect(
			createCloudCheckoutSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
			}),
		).resolves.toBe('https://checkout.stripe.com/existing');
		expect(stripeMocks.createCheckoutSession).not.toHaveBeenCalled();
	});

	it('rejects initial Checkout when Stripe already has cloud subscription history', async () => {
		stripeMocks.listSubscriptions.mockResolvedValue({ data: [cloudSubscription()] });

		await expect(
			createCloudCheckoutSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
			}),
		).rejects.toThrow('already has cloud subscription history');
		expect(stripeMocks.createCheckoutSession).not.toHaveBeenCalled();
	});

	it('recognizes a historical Price on the configured cloud Product', async () => {
		const subscription = cloudSubscription();
		subscription.items.data[0].price = cloudMonthlyPrice({
			id: 'price_cloud_monthly_legacy',
			active: false,
		});
		stripeMocks.listSubscriptions.mockResolvedValue({ data: [subscription] });

		await expect(listCloudSubscriptions('cus_cloud')).resolves.toEqual([subscription]);
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
			}),
		).resolves.toBe('https://checkout.stripe.com/resubscribe');

		expect(stripeMocks.createCheckoutSession).toHaveBeenCalledWith(
			expect.objectContaining({
				customer: 'cus_cloud',
				payment_method_collection: 'always',
				metadata: {
					nao_org_id: 'org-id',
					nao_plan_key: 'cloud_monthly_v2',
					nao_checkout_kind: 'resubscribe',
				},
				subscription_data: {
					metadata: { nao_org_id: 'org-id', nao_plan_key: 'cloud_monthly_v2' },
				},
				success_url: 'https://cloud.getnao.io/settings/organization/billing?checkout=subscribed',
			}),
			{ idempotencyKey: 'cloud-checkout-resubscribe-v4:org-id:sub_cloud' },
		);
	});

	it('reuses a legacy resubscribe Checkout Session', async () => {
		stripeMocks.listSubscriptions.mockResolvedValue({
			data: [cloudSubscription({ status: 'canceled' })],
		});
		stripeMocks.listCheckoutSessions.mockResolvedValue({
			data: [
				{
					mode: 'subscription',
					metadata: {
						nao_org_id: 'org-id',
						nao_plan_key: 'cloud_monthly_v2',
						nao_checkout_kind: 'subscription',
					},
					url: 'https://checkout.stripe.com/existing',
				},
			],
		});

		await expect(
			createCloudResubscribeSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
			}),
		).resolves.toBe('https://checkout.stripe.com/existing');
		expect(stripeMocks.createCheckoutSession).not.toHaveBeenCalled();
	});

	it('rejects a new Checkout Session while a current subscription exists', async () => {
		stripeMocks.listSubscriptions.mockResolvedValue({ data: [cloudSubscription({ status: 'active' })] });

		await expect(
			createCloudResubscribeSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
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
			hasDefaultPaymentMethod: false,
			billingAccessEndsAt: new Date(cancellationEndsAt * 1_000),
		});
	});

	it('projects the Customer default payment method without storing card details', async () => {
		stripeMocks.retrieveCustomer.mockResolvedValue({
			deleted: false,
			default_source: null,
			invoice_settings: { default_payment_method: 'pm_cloud' },
		});

		await expect(cloudSubscriptionProjection(cloudSubscription())).resolves.toMatchObject({
			hasDefaultPaymentMethod: true,
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
