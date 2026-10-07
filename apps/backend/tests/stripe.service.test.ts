import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stripeMocks = vi.hoisted(() => ({
	construct: vi.fn(),
	createCheckoutSession: vi.fn(),
	createCustomer: vi.fn(),
	createInvoicePreview: vi.fn(),
	createPortalSession: vi.fn(),
	listCheckoutSessions: vi.fn(),
	listInvoices: vi.fn(),
	listPrices: vi.fn(),
	listSubscriptions: vi.fn(),
	retrievePrice: vi.fn(),
	resumeSubscription: vi.fn(),
	retrieveCustomer: vi.fn(),
	retrieveSubscription: vi.fn(),
	retrieveTaxSettings: vi.fn(),
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
		invoices = {
			createPreview: stripeMocks.createInvoicePreview,
			list: stripeMocks.listInvoices,
		};
		prices = {
			list: stripeMocks.listPrices,
			retrieve: stripeMocks.retrievePrice,
		};
		subscriptions = {
			list: stripeMocks.listSubscriptions,
			resume: stripeMocks.resumeSubscription,
			retrieve: stripeMocks.retrieveSubscription,
		};
		tax = { settings: { retrieve: stripeMocks.retrieveTaxSettings } };
	},
}));

import type Stripe from 'stripe';

import { __reloadEnvForTesting } from '../src/env';
import {
	__resetStripeForTesting,
	cloudSubscriptionProjection,
	createCloudCheckoutSession,
	createCloudCustomer,
	createCloudPaymentMethodSession,
	createCloudPortalSession,
	createCloudResubscribeSession,
	findCloudSubscription,
	getCloudBillingPlans,
	getCloudMonthlyPrice,
	getCloudUpcomingInvoice,
	getStripeClient,
	listCloudInvoices,
	listCloudSubscriptions,
	resumeCloudSubscription,
	validateCloudBillingConfiguration,
} from '../src/services/stripe.service';

let originalEnv: typeof process.env;

beforeEach(() => {
	originalEnv = { ...process.env };
	process.env.BETTER_AUTH_URL = 'https://cloud.getnao.io';
	process.env.CLOUD_BILLING_ENABLED = 'true';
	process.env.NAO_MODE = 'cloud';
	process.env.STRIPE_CLOUD_PRODUCT_ID = 'prod_cloud';
	process.env.STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY = 'nao_cloud_monthly_v2';
	process.env.STRIPE_SECRET_KEY = 'sk_test_example';
	process.env.STRIPE_WEBHOOK_SECRET = 'whsec_example';
	__reloadEnvForTesting();
	__resetStripeForTesting();
	vi.clearAllMocks();
	stripeMocks.listPrices.mockResolvedValue({ data: [cloudMonthlyPrice()] });
	stripeMocks.listCheckoutSessions.mockReturnValue(paginatedList([]));
	stripeMocks.listSubscriptions.mockReturnValue(paginatedList([]));
	stripeMocks.retrieveCustomer.mockResolvedValue({
		deleted: false,
		default_source: null,
		invoice_settings: { default_payment_method: null },
	});
	stripeMocks.retrieveTaxSettings.mockResolvedValue({
		status: 'active',
		status_details: { active: {} },
	});
});

afterEach(() => {
	process.env = originalEnv;
	__reloadEnvForTesting();
	__resetStripeForTesting();
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
		['different currency', { currency: 'eur' }],
		['zero amount', { unit_amount: 0 }],
		['one-time', { type: 'one_time', recurring: null }],
		['yearly', { recurring: recurring({ interval: 'year' }) }],
		['multi-month', { recurring: recurring({ interval_count: 2 }) }],
		['metered', { recurring: recurring({ usage_type: 'metered' }) }],
	] satisfies Array<[string, Partial<Stripe.Price>]>)('rejects an %s Price', async (_name, overrides) => {
		stripeMocks.listPrices.mockResolvedValue({ data: [cloudMonthlyPrice(overrides)] });

		await expect(getCloudMonthlyPrice()).rejects.toThrow(
			'Stripe Price "price_cloud_monthly" must belong to configured active Product "prod_cloud" and be a fixed positive USD monthly licensed Price',
		);
	});

	it('rejects a Price from a different Product', async () => {
		stripeMocks.listPrices.mockResolvedValue({
			data: [cloudMonthlyPrice({ product: cloudProduct({ id: 'prod_other' }) })],
		});

		await expect(getCloudMonthlyPrice()).rejects.toThrow(
			'Stripe Price "price_cloud_monthly" must belong to configured active Product "prod_cloud"',
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
				currency: 'eur',
				product: 'prod_cloud',
				unit_amount: 200_000,
			}),
		);

		await expect(getCloudBillingPlans('price_legacy')).resolves.toMatchObject({
			availablePlan: { amount: 250_000, currency: 'usd' },
			subscriptionPlan: { amount: 200_000, currency: 'eur' },
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

describe('validateCloudBillingConfiguration', () => {
	it('validates the configured Price and active Stripe Tax settings', async () => {
		await expect(validateCloudBillingConfiguration()).resolves.toBeUndefined();

		expect(stripeMocks.listPrices).toHaveBeenCalledOnce();
		expect(stripeMocks.retrieveTaxSettings).toHaveBeenCalledOnce();
	});

	it('rejects pending Stripe Tax settings with missing fields', async () => {
		stripeMocks.retrieveTaxSettings.mockResolvedValue({
			status: 'pending',
			status_details: { pending: { missing_fields: ['head_office'] } },
		});

		await expect(validateCloudBillingConfiguration()).rejects.toThrow(
			'Stripe Tax must be active; missing: head_office',
		);
	});
});

describe('cloud Checkout', () => {
	it('requires a saved card and tax details before starting a new trial', async () => {
		stripeMocks.createCheckoutSession.mockResolvedValue({
			url: 'https://checkout.stripe.com/trial',
		});

		await expect(
			createCloudCheckoutSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				trialDays: 14,
			}),
		).resolves.toBe('https://checkout.stripe.com/trial');

		expect(stripeMocks.createCheckoutSession).toHaveBeenCalledWith(
			expect.objectContaining({
				line_items: [{ price: 'price_cloud_monthly', quantity: 1 }],
				allow_promotion_codes: true,
				custom_text: {
					submit: {
						message:
							'Nothing is charged today. Your 14-day free trial starts when you confirm. The recurring price shown, including any promotion code discount, starts after the trial.',
					},
				},
				payment_method_collection: 'always',
				payment_method_types: ['card'],
				automatic_tax: { enabled: true },
				tax_id_collection: { enabled: true },
				billing_address_collection: 'required',
				subscription_data: {
					metadata: { nao_org_id: 'org-id', nao_plan_key: 'cloud_monthly_v2' },
					trial_period_days: 14,
					trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
				},
			}),
			{ idempotencyKey: 'cloud-checkout-initial-v6:org-id:trial-14' },
		);
	});

	it('replaces an open Checkout Session that does not accept promotion codes', async () => {
		stripeMocks.listCheckoutSessions.mockReturnValueOnce(
			paginatedList([
				{
					mode: 'subscription',
					allow_promotion_codes: false,
					url: 'https://checkout.stripe.com/legacy',
					metadata: {
						nao_org_id: 'org-id',
						nao_plan_key: 'cloud_monthly_v2',
						nao_checkout_kind: 'initial',
					},
				},
			]),
		);
		stripeMocks.createCheckoutSession.mockResolvedValue({
			url: 'https://checkout.stripe.com/promotion-codes',
		});

		await expect(
			createCloudCheckoutSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				trialDays: 14,
			}),
		).resolves.toBe('https://checkout.stripe.com/promotion-codes');

		expect(stripeMocks.createCheckoutSession).toHaveBeenCalledWith(
			expect.objectContaining({ allow_promotion_codes: true }),
			{ idempotencyKey: 'cloud-checkout-initial-v6:org-id:trial-14' },
		);
	});

	it('reuses a matching open Checkout Session after the first page', async () => {
		const firstPage = Array.from({ length: 100 }, (_, index) => ({
			id: `cs_unrelated_${index}`,
			mode: 'payment' as const,
		}));
		const existingSession = {
			id: 'cs_existing',
			mode: 'subscription' as const,
			allow_promotion_codes: true,
			custom_text: {
				submit: {
					message:
						'Nothing is charged today. Your 14-day free trial starts when you confirm. The recurring price shown, including any promotion code discount, starts after the trial.',
				},
			},
			metadata: {
				nao_org_id: 'org-id',
				nao_plan_key: 'cloud_monthly_v2',
				nao_checkout_kind: 'initial',
			},
			url: 'https://checkout.stripe.com/existing',
		};
		stripeMocks.listCheckoutSessions.mockImplementation((params: Stripe.Checkout.SessionListParams) => {
			if (params.starting_after) {
				return paginatedList([existingSession]);
			}
			return paginatedList(firstPage, () =>
				stripeMocks.listCheckoutSessions({
					...params,
					starting_after: firstPage.at(-1)?.id,
				}),
			);
		});

		await expect(
			createCloudCheckoutSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				trialDays: 14,
			}),
		).resolves.toBe('https://checkout.stripe.com/existing');

		expect(stripeMocks.createCheckoutSession).not.toHaveBeenCalled();
		expect(stripeMocks.listCheckoutSessions).toHaveBeenNthCalledWith(2, {
			customer: 'cus_cloud',
			limit: 100,
			starting_after: 'cs_unrelated_99',
			status: 'open',
		});
	});

	it('creates a new Checkout after the previous Session was expired', async () => {
		stripeMocks.listCheckoutSessions.mockReturnValueOnce(paginatedList([])).mockReturnValueOnce(
			paginatedList([
				{
					id: 'cs_expired',
					mode: 'subscription',
					allow_promotion_codes: true,
					custom_text: {
						submit: {
							message:
								'Nothing is charged today. Your 14-day free trial starts when you confirm. The recurring price shown, including any promotion code discount, starts after the trial.',
						},
					},
					metadata: {
						nao_org_id: 'org-id',
						nao_plan_key: 'cloud_monthly_v2',
						nao_checkout_kind: 'initial',
					},
				},
			]),
		);
		stripeMocks.createCheckoutSession.mockResolvedValue({
			url: 'https://checkout.stripe.com/replacement',
		});

		await expect(
			createCloudCheckoutSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				trialDays: 14,
			}),
		).resolves.toBe('https://checkout.stripe.com/replacement');

		expect(stripeMocks.createCheckoutSession).toHaveBeenCalledWith(expect.anything(), {
			idempotencyKey: 'cloud-checkout-initial-v6:org-id:trial-14:cs_expired',
		});
	});

	it('rejects initial Checkout when Stripe already has cloud subscription history', async () => {
		stripeMocks.listSubscriptions.mockReturnValue(paginatedList([cloudSubscription()]));

		await expect(
			createCloudCheckoutSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				trialDays: 14,
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
		stripeMocks.listPrices.mockRejectedValue(new Error('Current Price is unavailable'));
		stripeMocks.listSubscriptions.mockReturnValue(paginatedList([subscription]));

		await expect(listCloudSubscriptions('cus_cloud')).resolves.toEqual([subscription]);
		expect(stripeMocks.listPrices).not.toHaveBeenCalled();
	});

	it('recognizes a cloud Product subscription whose quantity was changed in Stripe', async () => {
		const subscription = cloudSubscription();
		subscription.items.data[0].quantity = 2;
		stripeMocks.listSubscriptions.mockReturnValue(paginatedList([subscription]));

		await expect(listCloudSubscriptions('cus_cloud')).resolves.toEqual([subscription]);
	});

	it('finds only subscriptions on the configured cloud Product', async () => {
		const cloud = cloudSubscription();
		const unrelated = cloudSubscription({ id: 'sub_unrelated' });
		unrelated.items.data[0].price = cloudMonthlyPrice({ product: 'prod_unrelated' });
		stripeMocks.retrieveSubscription.mockResolvedValueOnce(cloud).mockResolvedValueOnce(unrelated);

		await expect(findCloudSubscription('sub_cloud')).resolves.toBe(cloud);
		await expect(findCloudSubscription('sub_unrelated')).resolves.toBeNull();
	});

	it('creates a paid Checkout Session after a canceled subscription without another trial', async () => {
		stripeMocks.listSubscriptions.mockReturnValue(paginatedList([cloudSubscription({ status: 'canceled' })]));
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
			{ idempotencyKey: 'cloud-checkout-resubscribe-v6:org-id:sub_cloud' },
		);
	});

	it('rejects resubscription without Stripe subscription history', async () => {
		await expect(
			createCloudResubscribeSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
			}),
		).rejects.toThrow('no subscription history');
		expect(stripeMocks.createCheckoutSession).not.toHaveBeenCalled();
	});

	it('creates a paid recovery Checkout when missing subscription history is explicitly allowed', async () => {
		stripeMocks.createCheckoutSession.mockResolvedValue({
			url: 'https://checkout.stripe.com/recovery',
		});

		await expect(
			createCloudResubscribeSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				allowMissingHistory: true,
			}),
		).resolves.toBe('https://checkout.stripe.com/recovery');

		expect(stripeMocks.createCheckoutSession).toHaveBeenCalledWith(
			expect.objectContaining({
				customer: 'cus_cloud',
				subscription_data: {
					metadata: { nao_org_id: 'org-id', nao_plan_key: 'cloud_monthly_v2' },
				},
			}),
			{ idempotencyKey: 'cloud-checkout-resubscribe-v6:org-id:missing-subscription' },
		);
	});

	it('rejects a new Checkout Session while a current subscription exists', async () => {
		stripeMocks.listSubscriptions.mockReturnValue(paginatedList([cloudSubscription({ status: 'active' })]));

		await expect(
			createCloudResubscribeSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
			}),
		).rejects.toThrow('already has a current subscription');
		expect(stripeMocks.createCheckoutSession).not.toHaveBeenCalled();
	});

	it('rejects recovery when a current subscription appears after the first page', async () => {
		const historicalSubscriptions = Array.from({ length: 100 }, (_, index) =>
			cloudSubscription({
				created: index,
				id: `sub_historical_${index}`,
				status: 'canceled',
			}),
		);
		const currentSubscription = cloudSubscription({ created: 101, id: 'sub_current', status: 'active' });
		stripeMocks.listSubscriptions.mockImplementation((params: Stripe.SubscriptionListParams) => {
			if (params.starting_after) {
				return paginatedList([currentSubscription]);
			}
			return paginatedList(historicalSubscriptions, () =>
				stripeMocks.listSubscriptions({
					...params,
					starting_after: historicalSubscriptions.at(-1)?.id,
				}),
			);
		});

		await expect(
			createCloudResubscribeSession({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				allowMissingHistory: true,
			}),
		).rejects.toThrow('already has a current subscription');
		expect(stripeMocks.createCheckoutSession).not.toHaveBeenCalled();
		expect(stripeMocks.listSubscriptions).toHaveBeenNthCalledWith(2, {
			customer: 'cus_cloud',
			limit: 100,
			starting_after: 'sub_historical_99',
			status: 'all',
		});
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
	it('rejects a non-monthly Price on the cloud Product', async () => {
		const subscription = cloudSubscription();
		subscription.items.data[0].price = cloudMonthlyPrice({ recurring: recurring({ interval: 'year' }) });

		await expect(cloudSubscriptionProjection(subscription)).rejects.toThrow('has no cloud plan item');
	});

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
			cancellationScheduled: true,
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
			currentPeriodStartsAt: new Date(1_799_000_000_000),
			hasDefaultPaymentMethod: true,
		});
	});
});

describe('cloud billing recovery', () => {
	it('uses Stripe to calculate the next payment after promotions', async () => {
		stripeMocks.createInvoicePreview.mockResolvedValue({
			amount_due: 100_000,
			currency: 'usd',
			period_start: 1_796_000_000,
			period_end: 1_798_592_000,
			discounts: [
				{
					id: 'di_early_customer',
					promotion_code: { code: 'EARLY50' },
				},
			],
		});

		await expect(getCloudUpcomingInvoice('sub_cloud')).resolves.toEqual({
			amountDue: 100_000,
			currency: 'usd',
			nextPaymentAt: new Date(1_796_000_000_000),
			promotionCodes: ['EARLY50'],
		});
		expect(stripeMocks.createInvoicePreview).toHaveBeenCalledWith({
			subscription: 'sub_cloud',
			expand: ['discounts.promotion_code'],
		});
	});

	it('lists a safe invoice history for the organization Customer', async () => {
		const stripeInvoices = [
			{
				id: 'in_cloud',
				number: 'NAO-0001',
				billing_reason: 'subscription_create',
				status: 'paid',
				created: 1_795_000_000,
				subtotal: 200_000,
				total: 100_000,
				currency: 'usd',
				discounts: [
					{
						id: 'di_early_customer',
						promotion_code: { code: 'EARLY50' },
					},
				],
				hosted_invoice_url: 'https://invoice.stripe.com/in_cloud',
				invoice_pdf: 'https://pay.stripe.com/invoice/in_cloud/pdf',
			},
			{
				id: 'in_trial',
				number: 'NAO-0002',
				billing_reason: 'subscription_create',
				status: 'paid',
				created: 1_794_000_000,
				subtotal: 0,
				total: 0,
				currency: 'usd',
				discounts: [],
				hosted_invoice_url: 'https://invoice.stripe.com/in_trial',
				invoice_pdf: 'https://pay.stripe.com/invoice/in_trial/pdf',
			},
			{
				id: 'in_trial_extension',
				number: 'NAO-0003',
				billing_reason: 'subscription_update',
				status: 'paid',
				created: 1_793_000_000,
				subtotal: 0,
				total: 0,
				currency: 'usd',
				discounts: [],
				hosted_invoice_url: 'https://invoice.stripe.com/in_trial_extension',
				invoice_pdf: 'https://pay.stripe.com/invoice/in_trial_extension/pdf',
			},
			{
				id: 'in_discounted_resubscription',
				number: 'NAO-0004',
				billing_reason: 'subscription_create',
				status: 'paid',
				created: 1_792_000_000,
				subtotal: 200_000,
				total: 0,
				currency: 'usd',
				discounts: [
					{
						id: 'di_free_resubscription',
						promotion_code: { code: 'FREE100' },
					},
				],
				hosted_invoice_url: 'https://invoice.stripe.com/in_discounted_resubscription',
				invoice_pdf: 'https://pay.stripe.com/invoice/in_discounted_resubscription/pdf',
			},
		];
		stripeMocks.listInvoices.mockReturnValue({
			data: stripeInvoices.slice(0, 1),
			async *[Symbol.asyncIterator]() {
				yield* stripeInvoices;
			},
		});

		await expect(listCloudInvoices('cus_cloud')).resolves.toEqual([
			{
				id: 'in_cloud',
				number: 'NAO-0001',
				invoiceKind: 'subscription',
				promotionCodes: ['EARLY50'],
				status: 'paid',
				createdAt: new Date(1_795_000_000_000),
				total: 100_000,
				currency: 'usd',
				hostedInvoiceUrl: 'https://invoice.stripe.com/in_cloud',
				invoicePdf: 'https://pay.stripe.com/invoice/in_cloud/pdf',
			},
			{
				id: 'in_trial',
				number: 'NAO-0002',
				invoiceKind: 'trial',
				promotionCodes: [],
				status: 'paid',
				createdAt: new Date(1_794_000_000_000),
				total: 0,
				currency: 'usd',
				hostedInvoiceUrl: 'https://invoice.stripe.com/in_trial',
				invoicePdf: 'https://pay.stripe.com/invoice/in_trial/pdf',
			},
			{
				id: 'in_trial_extension',
				number: 'NAO-0003',
				invoiceKind: 'no_charge',
				promotionCodes: [],
				status: 'paid',
				createdAt: new Date(1_793_000_000_000),
				total: 0,
				currency: 'usd',
				hostedInvoiceUrl: 'https://invoice.stripe.com/in_trial_extension',
				invoicePdf: 'https://pay.stripe.com/invoice/in_trial_extension/pdf',
			},
			{
				id: 'in_discounted_resubscription',
				number: 'NAO-0004',
				invoiceKind: 'no_charge',
				promotionCodes: ['FREE100'],
				status: 'paid',
				createdAt: new Date(1_792_000_000_000),
				total: 0,
				currency: 'usd',
				hostedInvoiceUrl: 'https://invoice.stripe.com/in_discounted_resubscription',
				invoicePdf: 'https://pay.stripe.com/invoice/in_discounted_resubscription/pdf',
			},
		]);
		expect(stripeMocks.listInvoices).toHaveBeenCalledWith({
			customer: 'cus_cloud',
			expand: ['data.discounts.promotion_code'],
			limit: 100,
		});
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
		currency: 'usd',
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
					current_period_start: 1_799_000_000,
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

function paginatedList<T>(items: T[], nextPage?: () => AsyncIterable<T>): AsyncIterable<T> & { data: T[] } {
	return {
		data: items,
		async *[Symbol.asyncIterator]() {
			yield* items;
			if (nextPage) {
				yield* nextPage();
			}
		},
	};
}
