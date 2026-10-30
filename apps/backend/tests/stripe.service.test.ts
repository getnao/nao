import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stripeMocks = vi.hoisted(() => ({
	construct: vi.fn(),
	cancelSubscription: vi.fn(),
	createCheckoutSession: vi.fn(),
	createCustomer: vi.fn(),
	createInvoicePreview: vi.fn(),
	createPortalSession: vi.fn(),
	createSubscription: vi.fn(),
	createSubscriptionSchedule: vi.fn(),
	expireCheckoutSession: vi.fn(),
	listCheckoutSessions: vi.fn(),
	listInvoices: vi.fn(),
	listPrices: vi.fn(),
	listSubscriptions: vi.fn(),
	retrieveCheckoutSession: vi.fn(),
	retrievePrice: vi.fn(),
	retrieveProduct: vi.fn(),
	resumeSubscription: vi.fn(),
	retrieveCustomer: vi.fn(),
	retrieveSubscription: vi.fn(),
	retrieveSubscriptionSchedule: vi.fn(),
	releaseSubscriptionSchedule: vi.fn(),
	retrieveTaxSettings: vi.fn(),
	updateSubscription: vi.fn(),
	updateSubscriptionSchedule: vi.fn(),
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
				expire: stripeMocks.expireCheckoutSession,
				list: stripeMocks.listCheckoutSessions,
				retrieve: stripeMocks.retrieveCheckoutSession,
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
		products = {
			retrieve: stripeMocks.retrieveProduct,
		};
		subscriptions = {
			cancel: stripeMocks.cancelSubscription,
			create: stripeMocks.createSubscription,
			list: stripeMocks.listSubscriptions,
			resume: stripeMocks.resumeSubscription,
			retrieve: stripeMocks.retrieveSubscription,
			update: stripeMocks.updateSubscription,
		};
		subscriptionSchedules = {
			create: stripeMocks.createSubscriptionSchedule,
			release: stripeMocks.releaseSubscriptionSchedule,
			retrieve: stripeMocks.retrieveSubscriptionSchedule,
			update: stripeMocks.updateSubscriptionSchedule,
		};
		tax = { settings: { retrieve: stripeMocks.retrieveTaxSettings } };
	},
}));

import type Stripe from 'stripe';

import { __reloadEnvForTesting } from '../src/env';
import {
	createCreditTopUpCheckoutSession,
	getCreditTopUpPurchase,
	validateCreditTopUpConfiguration,
} from '../src/services/credit-top-up.service';
import {
	__resetStripeForTesting,
	cloudSubscriptionProjection,
	createCloudCheckoutSession,
	createCloudCustomer,
	createCloudPaymentMethodSession,
	createCloudPlanChangeSchedule,
	createCloudPortalSession,
	createCloudResubscribeSession,
	createCloudTrialPlaceholderSubscription,
	findCloudSubscription,
	findManagedCloudSubscription,
	getCloudBillingPlans,
	getCloudPlanChangeSchedule,
	getCloudPrice,
	getCloudSubscriptionCurrency,
	getCloudUpcomingInvoice,
	getStripeClient,
	listCloudInvoices,
	listCloudSubscriptions,
	listCurrentCloudSubscriptions,
	previewCloudSubscriptionChange,
	releaseCloudPlanChangeSchedule,
	resumeCloudSubscription,
	updateCloudPlanChangeSchedule,
	updateCloudSubscriptionPlan,
	updateCloudSubscriptionQuantity,
	validateCloudBillingConfiguration,
} from '../src/services/stripe.service';

const TRIAL_END = new Date('2099-01-15T00:00:00.000Z');
const TRIAL_END_TIMESTAMP = Math.floor(TRIAL_END.getTime() / 1_000);
const TRIAL_MESSAGE =
	'Nothing is charged today. Your recurring price, including any promotion code discount, starts when your trial ends on January 15, 2099.';
const TRIAL_DAYS_MESSAGE =
	'Nothing is charged today. Your 14-day free trial starts when you confirm. The recurring price shown, including any promotion code discount, starts after the trial.';

let originalEnv: typeof process.env;

beforeEach(() => {
	originalEnv = { ...process.env };
	delete process.env.STRIPE_CLOUD_PRODUCT_ID;
	delete process.env.STRIPE_PORTAL_CONFIGURATION_ID;
	process.env.BETTER_AUTH_URL = 'https://cloud.getnao.io';
	process.env.CLOUD_BILLING_ENABLED = 'true';
	process.env.CLOUD_GITHUB_PROJECT_ORG = 'test-org';
	process.env.CLOUD_GITHUB_PROJECT_APP_ID = '123';
	process.env.CLOUD_GITHUB_PROJECT_INSTALLATION_ID = '456';
	process.env.CLOUD_GITHUB_PROJECT_PRIVATE_KEY = 'test-private-key';
	process.env.NAO_MODE = 'cloud';
	process.env.SMTP_HOST = 'smtp.example.com';
	process.env.SMTP_MAIL_FROM = 'hello@example.com';
	process.env.SMTP_PASSWORD = 'secret';
	process.env.CLOUD_FREE_TIER_ENABLED = 'false';
	process.env.STRIPE_CLOUD_LEGACY_PRODUCT_ID = 'prod_cloud';
	process.env.STRIPE_CLOUD_TEAM_PRODUCT_ID = 'prod_team';
	process.env.STRIPE_CLOUD_UNLIMITED_PRODUCT_ID = 'prod_unlimited';
	process.env.STRIPE_CLOUD_TRIAL_PRODUCT_ID = 'prod_cloud_trial';
	process.env.STRIPE_CLOUD_TRIAL_PRICE_LOOKUP_KEY = 'nao_trial';
	process.env.STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY = 'nao_cloud_monthly_v2';
	process.env.STRIPE_CLOUD_YEARLY_PRICE_LOOKUP_KEY = 'yearly_sub';
	process.env.STRIPE_CLOUD_TEAM_MONTHLY_PRICE_LOOKUP_KEY = 'configured_team_monthly';
	process.env.STRIPE_CLOUD_TEAM_YEARLY_PRICE_LOOKUP_KEY = 'configured_team_yearly';
	process.env.STRIPE_CLOUD_UNLIMITED_MONTHLY_PRICE_LOOKUP_KEY = 'configured_unlimited_monthly';
	process.env.STRIPE_CLOUD_UNLIMITED_YEARLY_PRICE_LOOKUP_KEY = 'configured_unlimited_yearly';
	process.env.STRIPE_CREDIT_PRODUCT_ID = 'prod_credits';
	process.env.STRIPE_CREDIT_PLATFORM_FEE_PRODUCT_ID = 'prod_platform_fee';
	process.env.STRIPE_SECRET_KEY = 'sk_test_example';
	process.env.STRIPE_WEBHOOK_SECRET = 'whsec_example';
	__reloadEnvForTesting();
	__resetStripeForTesting();
	vi.clearAllMocks();
	stripeMocks.listPrices.mockImplementation(({ lookup_keys }: Stripe.PriceListParams) => ({
		data: [priceForLookupKey(lookup_keys?.[0])],
	}));
	stripeMocks.listCheckoutSessions.mockReturnValue(paginatedList([]));
	stripeMocks.listSubscriptions.mockReturnValue(paginatedList([]));
	stripeMocks.expireCheckoutSession.mockResolvedValue({});
	stripeMocks.retrieveCustomer.mockResolvedValue({
		deleted: false,
		default_source: null,
		invoice_settings: { default_payment_method: null },
	});
	stripeMocks.retrieveTaxSettings.mockResolvedValue({
		status: 'active',
		status_details: { active: {} },
	});
	stripeMocks.retrieveProduct.mockImplementation((id: string) => ({ id, active: true }));
});

afterEach(() => {
	process.env = originalEnv;
	__reloadEnvForTesting();
	__resetStripeForTesting();
});

describe('getCloudPrice', () => {
	it('resolves the configured Team monthly Price', async () => {
		const expectedPrice = teamMonthlyPrice();
		stripeMocks.listPrices.mockResolvedValue({ data: [expectedPrice] });

		await expect(getCloudPrice('cloud_team_monthly_v1')).resolves.toBe(expectedPrice);
		expect(stripeMocks.listPrices).toHaveBeenCalledWith({
			active: true,
			expand: ['data.currency_options', 'data.product'],
			lookup_keys: ['configured_team_monthly'],
			limit: 1,
		});
	});

	it('resolves the configured Unlimited yearly Price', async () => {
		const expectedPrice = unlimitedYearlyPrice();
		stripeMocks.listPrices.mockResolvedValue({ data: [expectedPrice] });

		await expect(getCloudPrice('cloud_unlimited_yearly_v1')).resolves.toBe(expectedPrice);
		expect(stripeMocks.listPrices).toHaveBeenCalledWith({
			active: true,
			expand: ['data.currency_options', 'data.product'],
			lookup_keys: ['configured_unlimited_yearly'],
			limit: 1,
		});
	});

	it('rejects a monthly Price configured as the yearly offer', async () => {
		stripeMocks.listPrices.mockResolvedValue({ data: [teamMonthlyPrice()] });

		await expect(getCloudPrice('cloud_team_yearly_v1')).rejects.toThrow(
			'Stripe Price "price_team_monthly" must belong to configured active Product "prod_team"',
		);
	});

	it('rejects a missing Price', async () => {
		stripeMocks.listPrices.mockResolvedValue({ data: [] });

		await expect(getCloudPrice('cloud_team_monthly_v1')).rejects.toThrow(
			'No active Stripe Price found for lookup key "configured_team_monthly"',
		);
	});

	it.each([
		['inactive', { active: false }],
		['inactive product', { product: cloudProduct({ active: false, id: 'prod_team' }) }],
		['tiered', { billing_scheme: 'tiered' }],
		['non-USD default', { currency: 'eur' }],
		['wrong USD amount', { unit_amount: 5_001 }],
		['wrong EUR amount', { currency_options: { eur: { unit_amount: 5_001 } } }],
		['zero amount', { unit_amount: 0 }],
		['one-time', { type: 'one_time', recurring: null }],
		['yearly', { recurring: recurring({ interval: 'year' }) }],
		['multi-month', { recurring: recurring({ interval_count: 2 }) }],
		['metered', { recurring: recurring({ usage_type: 'metered' }) }],
		['unknown lookup key', { lookup_key: 'unknown_team_monthly' }],
	] satisfies Array<[string, Partial<Stripe.Price>]>)('rejects an %s Price', async (_name, overrides) => {
		stripeMocks.listPrices.mockResolvedValue({ data: [teamMonthlyPrice(overrides)] });

		await expect(getCloudPrice('cloud_team_monthly_v1')).rejects.toThrow(
			'Stripe Price "price_team_monthly" must belong to configured active Product "prod_team" and be a fixed USD 5000 and EUR 5000 monthly licensed Price',
		);
	});

	it('returns the selected currency option for every available plan', async () => {
		await expect(getCloudBillingPlans(undefined, 'eur')).resolves.toMatchObject({
			availablePlans: {
				monthly: { amount: 200_000, currency: 'eur' },
				yearly: { amount: 2_000_000, currency: 'eur' },
			},
		});
	});

	it('rejects a Price from a different Product', async () => {
		stripeMocks.listPrices.mockResolvedValue({
			data: [teamMonthlyPrice({ product: cloudProduct({ id: 'prod_other' }) })],
		});

		await expect(getCloudPrice('cloud_team_monthly_v1')).rejects.toThrow(
			'Stripe Price "price_team_monthly" must belong to configured active Product "prod_team"',
		);
	});

	it("returns an existing subscription's historical Price separately from the current offer", async () => {
		stripeMocks.listPrices.mockImplementation(({ lookup_keys }: Stripe.PriceListParams) => ({
			data: [
				lookup_keys?.[0] === 'yearly_sub' ? cloudYearlyPrice() : cloudMonthlyPrice({ unit_amount: 250_000 }),
			],
		}));
		stripeMocks.retrievePrice.mockImplementation((_priceId: string, params?: Stripe.PriceRetrieveParams) =>
			cloudMonthlyPrice({
				id: 'price_legacy',
				active: false,
				currency_options: params?.expand?.includes('currency_options')
					? ({ eur: { unit_amount: 200_000 } } as Stripe.Price['currency_options'])
					: undefined,
				product: 'prod_cloud',
				unit_amount: 200_000,
			}),
		);

		await expect(getCloudBillingPlans('price_legacy', 'usd', 'eur')).resolves.toMatchObject({
			availablePlans: {
				monthly: { amount: 250_000, currency: 'usd' },
				yearly: { amount: 2_000_000, currency: 'usd' },
			},
			subscriptionPlan: { amount: 200_000, currency: 'eur' },
		});
		expect(stripeMocks.retrievePrice).toHaveBeenCalledWith('price_legacy', {
			expand: ['currency_options'],
		});
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

		expect(stripeMocks.listPrices).toHaveBeenCalledTimes(7);
		expect(stripeMocks.retrieveTaxSettings).toHaveBeenCalledOnce();
	});

	it('does not require active legacy Prices after the free-tier flag is enabled', async () => {
		process.env.CLOUD_FREE_TIER_ENABLED = 'true';
		delete process.env.STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY;
		delete process.env.STRIPE_CLOUD_YEARLY_PRICE_LOOKUP_KEY;
		__reloadEnvForTesting();
		__resetStripeForTesting();

		await expect(validateCloudBillingConfiguration()).resolves.toBeUndefined();
		expect(stripeMocks.listPrices).toHaveBeenCalledTimes(5);
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

	it('rejects a non-zero placeholder Price', async () => {
		stripeMocks.listPrices.mockImplementation(({ lookup_keys }: Stripe.PriceListParams) => ({
			data: [
				lookup_keys?.[0] === 'nao_trial'
					? cloudTrialPrice({ unit_amount: 1 })
					: priceForLookupKey(lookup_keys?.[0]),
			],
		}));

		await expect(validateCloudBillingConfiguration()).rejects.toThrow('fixed $0 recurring licensed Price');
	});
});

describe('validateCreditTopUpConfiguration', () => {
	it('validates distinct active credit Products', async () => {
		await expect(validateCreditTopUpConfiguration()).resolves.toBeUndefined();

		expect(stripeMocks.retrieveProduct).toHaveBeenCalledWith('prod_credits');
		expect(stripeMocks.retrieveProduct).toHaveBeenCalledWith('prod_platform_fee');
	});
});

describe('cloud trial placeholder', () => {
	it('creates a no-card Subscription with the configured absolute trial end', async () => {
		stripeMocks.createSubscription.mockResolvedValue(cloudTrialSubscription());

		await expect(
			createCloudTrialPlaceholderSubscription({
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				trialEnd: TRIAL_END,
			}),
		).resolves.toMatchObject({ id: 'sub_cloud_trial' });

		expect(stripeMocks.createSubscription).toHaveBeenCalledWith(
			{
				customer: 'cus_cloud',
				items: [{ price: 'price_cloud_trial', quantity: 1 }],
				metadata: { nao_org_id: 'org-id', nao_subscription_kind: 'trial-placeholder' },
				cancel_at: TRIAL_END_TIMESTAMP,
				trial_end: TRIAL_END_TIMESTAMP,
				trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
			},
			{ idempotencyKey: 'cloud-trial-placeholder-v1:org-id' },
		);
	});
});

describe('cloud Checkout', () => {
	it('creates an idempotent USD credit Checkout with a separate 5% platform fee', async () => {
		stripeMocks.createCheckoutSession.mockResolvedValue({
			url: 'https://checkout.stripe.com/credits',
		});

		await expect(
			createCreditTopUpCheckoutSession({
				creditAmountCents: 2_000,
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				initiatingUserId: 'user-id',
				requestId: 'request-id',
			}),
		).resolves.toBe('https://checkout.stripe.com/credits');

		expect(stripeMocks.createCheckoutSession).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: 'payment',
				currency: 'usd',
				customer: 'cus_cloud',
				allow_promotion_codes: false,
				line_items: [
					{
						price_data: {
							currency: 'usd',
							product: 'prod_credits',
							unit_amount: 2_000,
						},
						quantity: 1,
					},
					{
						price_data: {
							currency: 'usd',
							product: 'prod_platform_fee',
							unit_amount: 100,
						},
						quantity: 1,
					},
				],
				success_url:
					'https://cloud.getnao.io/settings/organization/billing?creditCheckout={CHECKOUT_SESSION_ID}',
				cancel_url: 'https://cloud.getnao.io/settings/organization/billing?creditCheckout=canceled',
				expires_at: expect.any(Number),
			}),
			{ idempotencyKey: 'credit-top-up-v1:org-id:request-id' },
		);
	});

	it('reuses an open credit Checkout for the same purchase', async () => {
		stripeMocks.listCheckoutSessions.mockReturnValue(
			paginatedList([
				{
					id: 'cs_open',
					mode: 'payment',
					status: 'open',
					url: 'https://checkout.stripe.com/open-credits',
					metadata: {
						nao_org_id: 'org-id',
						nao_checkout_kind: 'credit_top_up',
						nao_credit_amount_cents: '2000',
						nao_wallet_amount_micro_usd: '20000000',
						nao_platform_fee_cents: '100',
						nao_initiating_user_id: 'user-id',
					},
				} as Stripe.Checkout.Session,
			]),
		);

		await expect(
			createCreditTopUpCheckoutSession({
				creditAmountCents: 2_000,
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				initiatingUserId: 'user-id',
				requestId: 'new-request-id',
			}),
		).resolves.toBe('https://checkout.stripe.com/open-credits');

		expect(stripeMocks.createCheckoutSession).not.toHaveBeenCalled();
		expect(stripeMocks.expireCheckoutSession).not.toHaveBeenCalled();
	});

	it('serializes concurrent credit Checkout creation for an organization', async () => {
		const sessions: Stripe.Checkout.Session[] = [];
		stripeMocks.listCheckoutSessions.mockImplementation(() => paginatedList(sessions));
		stripeMocks.createCheckoutSession.mockImplementation((params: Stripe.Checkout.SessionCreateParams) => {
			const session = {
				id: 'cs_created',
				mode: 'payment',
				status: 'open',
				url: 'https://checkout.stripe.com/created-credits',
				metadata: params.metadata,
			} as Stripe.Checkout.Session;
			sessions.push(session);
			return session;
		});

		const createSession = (requestId: string) =>
			createCreditTopUpCheckoutSession({
				creditAmountCents: 2_000,
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				initiatingUserId: 'user-id',
				requestId,
			});

		await expect(Promise.all([createSession('request-1'), createSession('request-2')])).resolves.toEqual([
			'https://checkout.stripe.com/created-credits',
			'https://checkout.stripe.com/created-credits',
		]);
		expect(stripeMocks.createCheckoutSession).toHaveBeenCalledOnce();
	});

	it('expires a superseded credit Checkout before creating another', async () => {
		stripeMocks.listCheckoutSessions.mockReturnValue(
			paginatedList([
				{
					id: 'cs_open',
					mode: 'payment',
					status: 'open',
					url: 'https://checkout.stripe.com/open-credits',
					metadata: {
						nao_org_id: 'org-id',
						nao_checkout_kind: 'credit_top_up',
						nao_credit_amount_cents: '3000',
					},
				} as Stripe.Checkout.Session,
			]),
		);
		stripeMocks.createCheckoutSession.mockResolvedValue({
			url: 'https://checkout.stripe.com/new-credits',
		});

		await createCreditTopUpCheckoutSession({
			creditAmountCents: 2_000,
			organizationId: 'org-id',
			stripeCustomerId: 'cus_cloud',
			initiatingUserId: 'user-id',
			requestId: 'new-request-id',
		});

		expect(stripeMocks.expireCheckoutSession).toHaveBeenCalledWith('cs_open');
		expect(stripeMocks.createCheckoutSession).toHaveBeenCalledOnce();
	});

	it('honours the platform fee the customer paid even after the fee rate changes', async () => {
		stripeMocks.retrieveCheckoutSession.mockResolvedValue(
			paidCreditTopUpSession({ platformFeeCents: 50, amount_subtotal: 2_050, amount_total: 2_250 }),
		);

		await expect(getCreditTopUpPurchase('cs_top_up')).resolves.toEqual(
			expect.objectContaining({ creditAmountCents: 2_000, platformFeeCents: 50, totalAmountCents: 2_250 }),
		);
	});

	it('rejects a paid top-up whose line items disagree with its metadata', async () => {
		stripeMocks.retrieveCheckoutSession.mockResolvedValue(
			paidCreditTopUpSession({ platformFeeCents: 50, amount_subtotal: 2_100, amount_total: 2_300 }),
		);

		await expect(getCreditTopUpPurchase('cs_top_up')).rejects.toThrow('has invalid credit top-up amounts');
	});

	it('accepts a paid top-up only after canonical amounts and Products are verified', async () => {
		stripeMocks.retrieveCheckoutSession.mockResolvedValue({
			id: 'cs_top_up',
			mode: 'payment',
			payment_status: 'paid',
			currency: 'usd',
			customer: 'cus_cloud',
			client_reference_id: 'org-id',
			payment_intent: 'pi_top_up',
			invoice: 'in_top_up',
			metadata: {
				nao_checkout_kind: 'credit_top_up',
				nao_org_id: 'org-id',
				nao_initiating_user_id: 'user-id',
				nao_credit_amount_cents: '2000',
				nao_wallet_amount_micro_usd: '20000000',
				nao_platform_fee_cents: '100',
			},
			amount_subtotal: 2_100,
			amount_total: 2_300,
			total_details: { amount_discount: 0, amount_tax: 200 },
			line_items: {
				data: [
					{
						quantity: 1,
						currency: 'usd',
						amount_subtotal: 2_000,
						price: { product: 'prod_credits' },
					},
					{
						quantity: 1,
						currency: 'usd',
						amount_subtotal: 100,
						price: { product: 'prod_platform_fee' },
					},
				],
			},
		});

		await expect(getCreditTopUpPurchase('cs_top_up')).resolves.toEqual({
			checkoutSessionId: 'cs_top_up',
			paymentIntentId: 'pi_top_up',
			invoiceId: 'in_top_up',
			organizationId: 'org-id',
			initiatingUserId: 'user-id',
			stripeCustomerId: 'cus_cloud',
			creditAmountCents: 2_000,
			platformFeeCents: 100,
			walletAmountMicroUsd: 20_000_000,
			taxAmountCents: 200,
			totalAmountCents: 2_300,
		});
		expect(stripeMocks.retrieveCheckoutSession).toHaveBeenCalledWith('cs_top_up', {
			expand: ['line_items.data.price.product', 'payment_intent', 'invoice'],
		});
	});

	it('requires a saved card and tax details before starting a new trial', async () => {
		stripeMocks.createCheckoutSession.mockResolvedValue({
			url: 'https://checkout.stripe.com/trial',
		});

		await expect(
			createCloudCheckoutSession({
				billingInterval: 'monthly',
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				trialDays: 14,
			}),
		).resolves.toBe('https://checkout.stripe.com/trial');

		expect(stripeMocks.createCheckoutSession).toHaveBeenCalledWith(
			expect.objectContaining({
				currency: 'usd',
				line_items: [{ price: 'price_cloud_monthly', quantity: 1 }],
				allow_promotion_codes: true,
				custom_text: {
					submit: {
						message: TRIAL_DAYS_MESSAGE,
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
			{
				idempotencyKey: 'cloud-checkout-initial-v12:org-id:cloud_monthly_v2:usd:trial-14',
			},
		);
	});

	it('creates Team Checkout with the selected plan key and explicit seat quantity', async () => {
		stripeMocks.createCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.com/team' });

		await createCloudCheckoutSession({
			planKey: 'cloud_team_monthly_v1',
			quantity: 6,
			organizationId: 'org-id',
			stripeCustomerId: 'cus_cloud',
			trialDays: 14,
		});

		expect(stripeMocks.createCheckoutSession).toHaveBeenCalledWith(
			expect.objectContaining({
				line_items: [{ price: 'price_team_monthly', quantity: 6 }],
				metadata: expect.objectContaining({
					nao_plan_key: 'cloud_team_monthly_v1',
					nao_quantity: '6',
				}),
				subscription_data: expect.objectContaining({
					metadata: { nao_org_id: 'org-id', nao_plan_key: 'cloud_team_monthly_v1' },
				}),
			}),
			{
				idempotencyKey: 'cloud-checkout-initial-v12:org-id:cloud_team_monthly_v1:usd:trial-14:6',
			},
		);
	});

	it('starts the same EUR trial with the configured yearly Price when selected', async () => {
		stripeMocks.createCheckoutSession.mockResolvedValue({
			url: 'https://checkout.stripe.com/yearly-trial',
		});

		await expect(
			createCloudCheckoutSession({
				billingInterval: 'yearly',
				currency: 'eur',
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				trialEnd: TRIAL_END,
			}),
		).resolves.toBe('https://checkout.stripe.com/yearly-trial');

		expect(stripeMocks.createCheckoutSession).toHaveBeenCalledWith(
			expect.objectContaining({
				currency: 'eur',
				line_items: [{ price: 'price_cloud_yearly', quantity: 1 }],
				metadata: expect.objectContaining({ nao_plan_key: 'cloud_yearly_v1' }),
				subscription_data: expect.objectContaining({
					metadata: { nao_org_id: 'org-id', nao_plan_key: 'cloud_yearly_v1' },
					trial_end: TRIAL_END_TIMESTAMP,
				}),
			}),
			{
				idempotencyKey: `cloud-checkout-initial-v12:org-id:cloud_yearly_v1:eur:trial-${TRIAL_END_TIMESTAMP}-${TRIAL_END_TIMESTAMP}`,
			},
		);
	});

	it('starts the subscription immediately when Stripe cannot preserve the remaining trial', async () => {
		const now = new Date('2026-10-01T00:00:00.000Z');
		const localTrialEnd = new Date('2026-10-03T00:02:00.000Z');
		vi.useFakeTimers();
		vi.setSystemTime(now);
		stripeMocks.createCheckoutSession.mockResolvedValue({
			url: 'https://checkout.stripe.com/immediate',
		});

		try {
			await expect(
				createCloudCheckoutSession({
					billingInterval: 'monthly',
					organizationId: 'org-id',
					stripeCustomerId: 'cus_cloud',
					trialEnd: localTrialEnd,
				}),
			).resolves.toBe('https://checkout.stripe.com/immediate');
		} finally {
			vi.useRealTimers();
		}

		const [params, options] = stripeMocks.createCheckoutSession.mock.calls[0] as [
			Stripe.Checkout.SessionCreateParams,
			{ idempotencyKey: string },
		];
		expect(params.subscription_data).toEqual({
			metadata: { nao_org_id: 'org-id', nao_plan_key: 'cloud_monthly_v2' },
		});
		expect(params.metadata).not.toHaveProperty('nao_trial_end');
		expect(params.custom_text?.submit?.message).toBe(
			'Not enough time remains to preserve your free trial in Checkout, so your subscription starts when you confirm. The recurring price shown, including any promotion code discount, is charged today.',
		);
		expect(options.idempotencyKey).toBe('cloud-checkout-initial-v12:org-id:cloud_monthly_v2:usd:immediate');
	});

	it('expires an open monthly Checkout before creating a yearly Checkout', async () => {
		const monthlySession = {
			id: 'cs_monthly',
			mode: 'subscription' as const,
			allow_promotion_codes: true,
			metadata: {
				nao_org_id: 'org-id',
				nao_plan_key: 'cloud_monthly_v2',
				nao_checkout_kind: 'initial',
			},
			url: 'https://checkout.stripe.com/monthly',
		};
		stripeMocks.listCheckoutSessions.mockImplementation((params: Stripe.Checkout.SessionListParams) =>
			paginatedList(params.status === 'open' ? [monthlySession] : []),
		);
		stripeMocks.createCheckoutSession.mockResolvedValue({
			url: 'https://checkout.stripe.com/yearly',
		});

		await createCloudCheckoutSession({
			billingInterval: 'yearly',
			organizationId: 'org-id',
			stripeCustomerId: 'cus_cloud',
			trialEnd: TRIAL_END,
		});

		expect(stripeMocks.expireCheckoutSession).toHaveBeenCalledWith('cs_monthly');
		expect(stripeMocks.createCheckoutSession).toHaveBeenCalledWith(
			expect.objectContaining({ line_items: [{ price: 'price_cloud_yearly', quantity: 1 }] }),
			expect.anything(),
		);
		expect(stripeMocks.listCheckoutSessions).toHaveBeenCalledTimes(2);
	});

	it('continues when a superseded Checkout expires during an expiration race', async () => {
		stripeMocks.listCheckoutSessions.mockImplementation((params: Stripe.Checkout.SessionListParams) =>
			paginatedList(
				params.status === 'open'
					? [
							{
								id: 'cs_monthly',
								metadata: {
									nao_org_id: 'org-id',
									nao_plan_key: 'cloud_monthly_v2',
									nao_checkout_kind: 'initial',
								},
							},
						]
					: [],
			),
		);
		stripeMocks.expireCheckoutSession.mockRejectedValue(new Error('Session is no longer open'));
		stripeMocks.retrieveCheckoutSession.mockResolvedValue({ id: 'cs_monthly', status: 'expired' });
		stripeMocks.createCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.com/yearly' });

		await expect(
			createCloudCheckoutSession({
				billingInterval: 'yearly',
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				trialEnd: TRIAL_END,
			}),
		).resolves.toBe('https://checkout.stripe.com/yearly');
	});

	it('stops when a superseded Checkout completes during an expiration race', async () => {
		stripeMocks.listCheckoutSessions.mockReturnValue(
			paginatedList([
				{
					id: 'cs_monthly',
					metadata: {
						nao_org_id: 'org-id',
						nao_plan_key: 'cloud_monthly_v2',
						nao_checkout_kind: 'initial',
					},
				},
			]),
		);
		stripeMocks.expireCheckoutSession.mockRejectedValue(new Error('Session is no longer open'));
		stripeMocks.retrieveCheckoutSession.mockResolvedValue({ id: 'cs_monthly', status: 'complete' });

		await expect(
			createCloudCheckoutSession({
				billingInterval: 'yearly',
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				trialEnd: TRIAL_END,
			}),
		).rejects.toThrow('A Stripe Checkout completed while the billing interval was changing');
		expect(stripeMocks.createCheckoutSession).not.toHaveBeenCalled();
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
				billingInterval: 'monthly',
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				trialEnd: TRIAL_END,
			}),
		).resolves.toBe('https://checkout.stripe.com/promotion-codes');

		expect(stripeMocks.createCheckoutSession).toHaveBeenCalledWith(
			expect.objectContaining({ allow_promotion_codes: true }),
			{
				idempotencyKey: `cloud-checkout-initial-v12:org-id:cloud_monthly_v2:usd:trial-${TRIAL_END_TIMESTAMP}-${TRIAL_END_TIMESTAMP}`,
			},
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
			currency: 'usd',
			allow_promotion_codes: true,
			custom_text: {
				submit: {
					message: TRIAL_DAYS_MESSAGE,
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
				billingInterval: 'monthly',
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
					currency: 'usd',
					allow_promotion_codes: true,
					custom_text: {
						submit: {
							message: TRIAL_MESSAGE,
						},
					},
					metadata: {
						nao_org_id: 'org-id',
						nao_plan_key: 'cloud_monthly_v2',
						nao_checkout_kind: 'initial',
						nao_trial_end: String(TRIAL_END_TIMESTAMP),
					},
				},
			]),
		);
		stripeMocks.createCheckoutSession.mockResolvedValue({
			url: 'https://checkout.stripe.com/replacement',
		});

		await expect(
			createCloudCheckoutSession({
				billingInterval: 'monthly',
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				trialEnd: TRIAL_END,
			}),
		).resolves.toBe('https://checkout.stripe.com/replacement');

		expect(stripeMocks.createCheckoutSession).toHaveBeenCalledWith(expect.anything(), {
			idempotencyKey: `cloud-checkout-initial-v12:org-id:cloud_monthly_v2:usd:trial-${TRIAL_END_TIMESTAMP}-${TRIAL_END_TIMESTAMP}:cs_expired`,
		});
	});

	it('rejects initial Checkout when Stripe already has cloud subscription history', async () => {
		stripeMocks.listSubscriptions.mockReturnValue(paginatedList([cloudSubscription()]));

		await expect(
			createCloudCheckoutSession({
				billingInterval: 'monthly',
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				trialEnd: TRIAL_END,
			}),
		).rejects.toThrow('already has cloud subscription history');
		expect(stripeMocks.createCheckoutSession).not.toHaveBeenCalled();
	});

	it('allows initial paid Checkout while the trial placeholder is current', async () => {
		stripeMocks.listSubscriptions.mockReturnValue(paginatedList([cloudTrialSubscription()]));
		stripeMocks.createCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.com/paid-plan' });

		await expect(
			createCloudCheckoutSession({
				billingInterval: 'monthly',
				organizationId: 'org-id',
				stripeCustomerId: 'cus_cloud',
				trialEnd: TRIAL_END,
			}),
		).resolves.toBe('https://checkout.stripe.com/paid-plan');
	});

	it('recognizes a historical Price on the configured cloud Product', async () => {
		const subscription = cloudSubscription();
		subscription.items.data[0].price = cloudMonthlyPrice({
			id: 'price_cloud_monthly_legacy',
			active: false,
		});
		stripeMocks.listPrices.mockRejectedValue(new Error('Current Price is unavailable'));
		stripeMocks.listSubscriptions.mockReturnValue(paginatedList([subscription]));

		await expect(listCloudSubscriptions('cus_cloud')).resolves.toEqual([{ kind: 'paid-cloud', subscription }]);
		expect(stripeMocks.listPrices).not.toHaveBeenCalled();
	});

	it('recognizes an inactive grandfathered Price when the free-tier flag is enabled', async () => {
		process.env.CLOUD_FREE_TIER_ENABLED = 'true';
		delete process.env.STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY;
		delete process.env.STRIPE_CLOUD_YEARLY_PRICE_LOOKUP_KEY;
		__reloadEnvForTesting();
		const subscription = cloudSubscription();
		subscription.items.data[0].price = cloudMonthlyPrice({
			active: false,
			lookup_key: null,
		});
		stripeMocks.listSubscriptions.mockReturnValue(paginatedList([subscription]));

		await expect(listCloudSubscriptions('cus_cloud')).resolves.toEqual([{ kind: 'paid-cloud', subscription }]);
	});

	it('rejects subscriptions that mix paid cloud Products', async () => {
		const subscription = cloudSubscription({
			items: {
				data: [
					{ price: teamMonthlyPrice(), quantity: 4 },
					{ price: unlimitedMonthlyPrice(), quantity: 1 },
				],
			} as Stripe.Subscription['items'],
		});
		stripeMocks.listSubscriptions.mockReturnValue(paginatedList([subscription]));

		await expect(listCloudSubscriptions('cus_cloud')).rejects.toThrow('mixes paid cloud Products');
	});

	it('rejects subscriptions that mix paid and trial placeholder Products', async () => {
		const subscription = cloudSubscription({
			items: {
				data: [
					{ price: teamMonthlyPrice(), quantity: 4 },
					{ price: cloudTrialPrice(), quantity: 1 },
				],
			} as Stripe.Subscription['items'],
		});
		stripeMocks.listSubscriptions.mockReturnValue(paginatedList([subscription]));

		await expect(listCloudSubscriptions('cus_cloud')).rejects.toThrow('mixes paid and trial placeholder Products');
	});

	it('recognizes a cloud Product subscription whose quantity was changed in Stripe', async () => {
		const subscription = cloudSubscription();
		subscription.items.data[0].quantity = 2;
		stripeMocks.listSubscriptions.mockReturnValue(paginatedList([subscription]));

		await expect(listCloudSubscriptions('cus_cloud')).resolves.toEqual([{ kind: 'paid-cloud', subscription }]);
	});

	it('finds only subscriptions on the configured cloud Product', async () => {
		const cloud = cloudSubscription();
		const unrelated = cloudSubscription({ id: 'sub_unrelated' });
		unrelated.items.data[0].price = cloudMonthlyPrice({ product: 'prod_unrelated' });
		stripeMocks.retrieveSubscription.mockResolvedValueOnce(cloud).mockResolvedValueOnce(unrelated);

		await expect(findCloudSubscription('sub_cloud')).resolves.toBe(cloud);
		await expect(findCloudSubscription('sub_unrelated')).resolves.toBeNull();
	});

	it('finds paid and trial-placeholder managed subscriptions', async () => {
		const paid = cloudSubscription();
		const placeholder = cloudTrialSubscription();
		const unrelated = cloudSubscription({ id: 'sub_unrelated' });
		unrelated.items.data[0].price = cloudMonthlyPrice({ product: 'prod_unrelated' });
		stripeMocks.retrieveSubscription
			.mockResolvedValueOnce(paid)
			.mockResolvedValueOnce(placeholder)
			.mockResolvedValueOnce(unrelated);

		await expect(findManagedCloudSubscription('sub_cloud')).resolves.toBe(paid);
		await expect(findManagedCloudSubscription('sub_cloud_trial')).resolves.toBe(placeholder);
		await expect(findManagedCloudSubscription('sub_unrelated')).resolves.toBeNull();
	});

	it('retrieves a subscription currency from Stripe once and drops failed lookups', async () => {
		stripeMocks.retrieveSubscription
			.mockRejectedValueOnce(new Error('stripe down'))
			.mockResolvedValue(cloudSubscription({ currency: 'eur' }));

		await expect(getCloudSubscriptionCurrency('sub_cloud')).rejects.toThrow('stripe down');
		await expect(getCloudSubscriptionCurrency('sub_cloud')).resolves.toBe('eur');
		await expect(getCloudSubscriptionCurrency('sub_cloud')).resolves.toBe('eur');

		expect(stripeMocks.retrieveSubscription).toHaveBeenCalledTimes(2);
	});

	it('does not let an evicted failed lookup delete a newer cached lookup', async () => {
		let rejectFirstLookup: (error: Error) => void;
		const firstLookup = new Promise<Stripe.Subscription>((_resolve, reject) => {
			rejectFirstLookup = reject;
		});
		stripeMocks.retrieveSubscription
			.mockReturnValueOnce(firstLookup)
			.mockResolvedValue(cloudSubscription({ currency: 'eur' }));

		const evictedLookup = getCloudSubscriptionCurrency('sub_cloud');
		__resetStripeForTesting();
		await expect(getCloudSubscriptionCurrency('sub_cloud')).resolves.toBe('eur');

		rejectFirstLookup!(new Error('stripe down'));
		await expect(evictedLookup).rejects.toThrow('stripe down');
		await expect(getCloudSubscriptionCurrency('sub_cloud')).resolves.toBe('eur');

		expect(stripeMocks.retrieveSubscription).toHaveBeenCalledTimes(2);
	});

	it('creates a paid Checkout Session after a canceled subscription without another trial', async () => {
		stripeMocks.listSubscriptions.mockReturnValue(paginatedList([cloudSubscription({ status: 'canceled' })]));
		stripeMocks.createCheckoutSession.mockResolvedValue({
			url: 'https://checkout.stripe.com/resubscribe',
		});

		await expect(
			createCloudResubscribeSession({
				billingInterval: 'monthly',
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
			{ idempotencyKey: 'cloud-checkout-resubscribe-v12:org-id:cloud_monthly_v2:usd:sub_cloud' },
		);
	});

	it('rejects resubscription without Stripe subscription history', async () => {
		await expect(
			createCloudResubscribeSession({
				billingInterval: 'monthly',
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
				billingInterval: 'monthly',
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
			{ idempotencyKey: 'cloud-checkout-resubscribe-v12:org-id:cloud_monthly_v2:usd:missing-subscription' },
		);
	});

	it('rejects a new Checkout Session while a current subscription exists', async () => {
		stripeMocks.listSubscriptions.mockReturnValue(paginatedList([cloudSubscription({ status: 'active' })]));

		await expect(
			createCloudResubscribeSession({
				billingInterval: 'monthly',
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
				billingInterval: 'monthly',
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
	it('projects a yearly Price to the yearly billing plan', async () => {
		const subscription = cloudSubscription();
		subscription.items.data[0].price = cloudYearlyPrice();

		await expect(cloudSubscriptionProjection(subscription)).resolves.toMatchObject({
			billingPlan: 'cloud_yearly_v1',
			stripeSubscriptionItemId: 'si_cloud',
			stripePriceId: 'price_cloud_yearly',
			seatQuantity: null,
		});
	});

	it.each([
		[teamMonthlyPrice(), 'cloud_team_monthly_v1'],
		[teamYearlyPrice(), 'cloud_team_yearly_v1'],
		[unlimitedMonthlyPrice(), 'cloud_unlimited_monthly_v1'],
		[unlimitedYearlyPrice(), 'cloud_unlimited_yearly_v1'],
	] as const)('projects the Product and lookup key for %s', async (price, billingPlan) => {
		const subscription = cloudSubscription();
		subscription.items.data[0].price = price;

		await expect(cloudSubscriptionProjection(subscription)).resolves.toMatchObject({
			billingPlan,
			stripePriceId: price.id,
		});
	});

	it('projects Team quantity from its Stripe subscription item', async () => {
		const subscription = cloudSubscription({
			items: {
				data: [{ id: 'si_team', price: teamMonthlyPrice(), quantity: 7 }],
			} as Stripe.Subscription['items'],
		});

		await expect(cloudSubscriptionProjection(subscription)).resolves.toMatchObject({
			billingPlan: 'cloud_team_monthly_v1',
			stripeSubscriptionItemId: 'si_team',
			seatQuantity: 7,
		});
	});

	it('never projects Unlimited or legacy quantity as seat capacity', async () => {
		const unlimited = cloudSubscription({
			items: {
				data: [{ id: 'si_unlimited', price: unlimitedMonthlyPrice(), quantity: 5 }],
			} as Stripe.Subscription['items'],
		});
		const legacy = cloudSubscription({
			items: {
				data: [{ id: 'si_legacy', price: cloudMonthlyPrice(), quantity: 12 }],
			} as Stripe.Subscription['items'],
		});

		await expect(cloudSubscriptionProjection(unlimited)).resolves.toMatchObject({ seatQuantity: null });
		await expect(cloudSubscriptionProjection(legacy)).resolves.toMatchObject({ seatQuantity: null });
	});

	it('projects an attached schedule future Team plan and explicit quantity', async () => {
		stripeMocks.retrieveSubscriptionSchedule.mockResolvedValue(
			cloudSubscriptionSchedule({
				phases: [
					schedulePhase(1_799_000_000, 1_800_000_000, unlimitedMonthlyPrice(), 1),
					schedulePhase(1_800_000_000, 1_802_592_000, teamYearlyPrice(), 6),
				],
			}),
		);

		await expect(
			cloudSubscriptionProjection(cloudSubscription({ schedule: 'sub_sched_team' })),
		).resolves.toMatchObject({
			stripeSubscriptionScheduleId: 'sub_sched_team',
			pendingBillingPlan: 'cloud_team_yearly_v1',
			pendingSeatQuantity: 6,
		});
		expect(stripeMocks.retrieveSubscriptionSchedule).toHaveBeenCalledWith('sub_sched_team', {
			expand: ['phases.items.price.product'],
		});
	});

	it('projects pending Unlimited without persisting Stripe quantity', async () => {
		const schedule = cloudSubscriptionSchedule({
			phases: [
				schedulePhase(1_799_000_000, 1_800_000_000, teamMonthlyPrice(), 8),
				schedulePhase(1_800_000_000, 1_802_592_000, unlimitedMonthlyPrice(), 1),
			],
		});

		await expect(cloudSubscriptionProjection(cloudSubscription({ schedule }))).resolves.toMatchObject({
			stripeSubscriptionScheduleId: 'sub_sched_team',
			pendingBillingPlan: 'cloud_unlimited_monthly_v1',
			pendingSeatQuantity: null,
		});
		expect(stripeMocks.retrieveSubscriptionSchedule).not.toHaveBeenCalled();
	});

	it.each(['released', 'completed', 'canceled'] as const)(
		'clears pending state for a %s schedule',
		async (status) => {
			const schedule = cloudSubscriptionSchedule({ status });

			await expect(cloudSubscriptionProjection(cloudSubscription({ schedule }))).resolves.toMatchObject({
				stripeSubscriptionScheduleId: null,
				pendingBillingPlan: null,
				pendingSeatQuantity: null,
			});
		},
	);

	it('rejects an unknown lookup key on a current Product', async () => {
		const subscription = cloudSubscription();
		subscription.items.data[0].price = teamMonthlyPrice({ lookup_key: 'unknown_team_monthly' });

		await expect(cloudSubscriptionProjection(subscription)).rejects.toThrow(
			'is not configured for its paid cloud Product',
		);
	});

	it('rejects an unsupported recurring interval on the cloud Product', async () => {
		const subscription = cloudSubscription();
		subscription.items.data[0].price = cloudMonthlyPrice({ recurring: recurring({ interval: 'week' }) });

		await expect(cloudSubscriptionProjection(subscription)).rejects.toThrow(
			'is not configured for its paid cloud Product',
		);
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

	it('projects a trial placeholder expiry separately from paid cancellation', async () => {
		const cancellationEndsAt = 1_800_000_000;
		stripeMocks.retrieveCustomer.mockResolvedValue({
			deleted: false,
			default_source: null,
			invoice_settings: { default_payment_method: 'pm_cloud' },
		});

		await expect(
			cloudSubscriptionProjection(cloudTrialSubscription({ cancel_at: cancellationEndsAt })),
		).resolves.toMatchObject({
			billingPlan: null,
			billingStatus: 'trialing',
			stripeSubscriptionItemId: null,
			seatQuantity: null,
			stripeSubscriptionScheduleId: null,
			pendingBillingPlan: null,
			pendingSeatQuantity: null,
			cancellationScheduled: false,
			hasDefaultPaymentMethod: true,
			billingAccessEndsAt: new Date(cancellationEndsAt * 1_000),
		});
	});

	it('projects a canceled trial placeholder without billing access', async () => {
		await expect(
			cloudSubscriptionProjection(cloudTrialSubscription({ status: 'canceled', cancel_at: 1_800_000_000 })),
		).resolves.toMatchObject({
			billingPlan: null,
			billingStatus: 'canceled',
			cancellationScheduled: false,
			billingAccessEndsAt: null,
		});
	});
});

describe('cloud billing recovery', () => {
	it('previews and applies a paid seat increase with the exact same proration timestamp', async () => {
		const subscription = cloudSubscription({
			status: 'active',
			items: {
				data: [{ id: 'si_team', price: teamMonthlyPrice(), quantity: 4 }],
			} as Stripe.Subscription['items'],
		});
		const prorationDate = new Date('2026-10-30T12:00:00.000Z');
		stripeMocks.createInvoicePreview.mockResolvedValue({
			amount_due: 2_500,
			subtotal: 2_500,
			total_taxes: [{ amount: 500 }],
			total_discount_amounts: [{ amount: 250 }],
			currency: 'usd',
			lines: {
				data: [
					{
						amount: 2_500,
						currency: 'usd',
						description: 'Unused time',
						parent: { subscription_item_details: { proration: true } },
						period: { start: 1_799_000_000, end: 1_800_000_000 },
					},
				],
			},
		});
		stripeMocks.updateSubscription.mockResolvedValue(subscription);

		await expect(
			previewCloudSubscriptionChange({
				subscription,
				targetPlanKey: 'cloud_team_monthly_v1',
				targetQuantity: 5,
				prorationDate,
				prorationBehavior: 'always_invoice',
			}),
		).resolves.toMatchObject({ amountDue: 2_500, tax: 500, discount: 250 });
		await updateCloudSubscriptionQuantity({
			organizationId: 'org-id',
			subscription,
			targetQuantity: 5,
			prorationDate,
			requestId: 'request-id',
		});

		const prorationTimestamp = Math.floor(prorationDate.getTime() / 1_000);
		expect(stripeMocks.createInvoicePreview).toHaveBeenCalledWith({
			subscription: 'sub_cloud',
			subscription_details: {
				items: [{ id: 'si_team', price: 'price_team_monthly', quantity: 5 }],
				proration_date: prorationTimestamp,
				proration_behavior: 'always_invoice',
			},
		});
		expect(stripeMocks.updateSubscription).toHaveBeenCalledWith(
			'sub_cloud',
			{
				items: [{ id: 'si_team', quantity: 5 }],
				payment_behavior: 'error_if_incomplete',
				proration_behavior: 'always_invoice',
				proration_date: prorationTimestamp,
			},
			{ idempotencyKey: 'cloud-seat-quantity-v1:org-id:sub_cloud:request-id:5' },
		);
	});

	it('keeps a paid subscription unchanged when Stripe rejects an immediate upgrade with 402', async () => {
		const subscription = cloudSubscription({
			status: 'active',
			items: {
				data: [{ id: 'si_team', price: teamMonthlyPrice(), quantity: 4 }],
			} as Stripe.Subscription['items'],
		});
		const paymentError = Object.assign(new Error('card declined'), { statusCode: 402 });
		stripeMocks.updateSubscription.mockRejectedValue(paymentError);

		await expect(
			updateCloudSubscriptionPlan({
				organizationId: 'org-id',
				subscription,
				targetPlanKey: 'cloud_unlimited_monthly_v1',
				targetQuantity: 1,
				prorationDate: new Date('2026-10-30T12:00:00.000Z'),
				requestId: 'request-id',
				chargeImmediately: true,
			}),
		).rejects.toBe(paymentError);

		expect(stripeMocks.updateSubscription).toHaveBeenCalledWith(
			'sub_cloud',
			expect.objectContaining({
				items: [{ id: 'si_team', price: 'price_unlimited_monthly', quantity: 1 }],
				payment_behavior: 'error_if_incomplete',
				proration_behavior: 'always_invoice',
			}),
			expect.anything(),
		);
	});

	it('clears a scheduled Free switch when changing a paid plan during trial', async () => {
		const subscription = cloudSubscription({
			status: 'trialing',
			cancel_at_period_end: true,
			trial_end: TRIAL_END_TIMESTAMP,
			items: {
				data: [{ id: 'si_team', price: teamMonthlyPrice(), quantity: 4 }],
			} as Stripe.Subscription['items'],
		});
		stripeMocks.updateSubscription.mockResolvedValue(subscription);

		await updateCloudSubscriptionPlan({
			organizationId: 'org-id',
			subscription,
			targetPlanKey: 'cloud_unlimited_monthly_v1',
			targetQuantity: 1,
			prorationDate: new Date('2026-10-30T12:00:00.000Z'),
			requestId: 'request-id',
			chargeImmediately: false,
		});

		expect(stripeMocks.updateSubscription).toHaveBeenCalledWith(
			'sub_cloud',
			expect.objectContaining({
				cancel_at_period_end: false,
				items: [{ id: 'si_team', price: 'price_unlimited_monthly', quantity: 1 }],
				proration_behavior: 'none',
				trial_end: TRIAL_END_TIMESTAMP,
			}),
			expect.anything(),
		);
	});

	it('creates, fully updates, and releases downgrade schedules without canceling them', async () => {
		const subscription = cloudSubscription({
			status: 'active',
			items: {
				data: [{ id: 'si_unlimited', price: unlimitedMonthlyPrice(), quantity: 1 }],
			} as Stripe.Subscription['items'],
		});
		const schedule = cloudSubscriptionSchedule();
		stripeMocks.createSubscriptionSchedule.mockResolvedValue(schedule);
		stripeMocks.retrieveSubscriptionSchedule.mockResolvedValue(schedule);
		stripeMocks.updateSubscriptionSchedule.mockResolvedValue(schedule);
		stripeMocks.releaseSubscriptionSchedule.mockResolvedValue({ ...schedule, status: 'released' });

		await createCloudPlanChangeSchedule({
			organizationId: 'org-id',
			subscription,
			targetPlanKey: 'cloud_team_monthly_v1',
			requestId: 'request-id',
		});
		const retrieved = await getCloudPlanChangeSchedule(schedule.id);
		await updateCloudPlanChangeSchedule({
			schedule: retrieved,
			targetPlanKey: 'cloud_team_monthly_v1',
			targetQuantity: 6,
			effectiveAt: new Date(1_800_000_000_000),
		});
		await releaseCloudPlanChangeSchedule(schedule.id);

		expect(stripeMocks.createSubscriptionSchedule).toHaveBeenCalledWith(
			{ from_subscription: 'sub_cloud' },
			{
				idempotencyKey: 'cloud-plan-schedule-v1:org-id:sub_cloud:request-id:cloud_team_monthly_v1',
			},
		);
		expect(stripeMocks.updateSubscriptionSchedule).toHaveBeenCalledWith(
			schedule.id,
			expect.objectContaining({
				end_behavior: 'release',
				proration_behavior: 'none',
				phases: expect.arrayContaining([
					expect.objectContaining({ items: expect.any(Array) }),
					expect.objectContaining({
						items: [{ price: 'price_team_monthly', quantity: 6 }],
						proration_behavior: 'none',
					}),
				]),
			}),
		);
		expect(stripeMocks.releaseSubscriptionSchedule).toHaveBeenCalledWith(schedule.id, {
			preserve_cancel_date: true,
		});
		expect(stripeMocks.cancelSubscription).not.toHaveBeenCalledWith(schedule.id);
	});

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

describe('listCurrentCloudSubscriptions', () => {
	it('lists Team, Unlimited and Legacy Unlimited subscriptions', async () => {
		const subscriptions = [
			cloudSubscription({
				id: 'sub_team',
				items: { data: [{ price: teamMonthlyPrice(), quantity: 4 }] } as Stripe.Subscription['items'],
			}),
			cloudSubscription({
				id: 'sub_unlimited',
				items: { data: [{ price: unlimitedMonthlyPrice(), quantity: 1 }] } as Stripe.Subscription['items'],
			}),
			cloudSubscription({ id: 'sub_legacy' }),
		];
		stripeMocks.listSubscriptions.mockImplementation(({ status }: Stripe.SubscriptionListParams) =>
			paginatedList(status === 'active' ? subscriptions : []),
		);

		await expect(listCurrentCloudSubscriptions()).resolves.toEqual([
			expect.objectContaining({ id: 'sub_team', monthlyAmount: 20_000 }),
			expect.objectContaining({ id: 'sub_unlimited', monthlyAmount: 200_000 }),
			expect.objectContaining({ id: 'sub_legacy', monthlyAmount: 200_000 }),
		]);
	});

	it('normalizes cloud subscriptions to a monthly amount net of recurring coupons', async () => {
		const subscriptionsByStatus: Record<string, Stripe.Subscription[]> = {
			active: [
				cloudSubscription({
					id: 'sub_yearly',
					status: 'active',
					currency: 'usd',
					items: { data: [{ price: cloudYearlyPrice(), quantity: 1 }] } as Stripe.Subscription['items'],
					discounts: [discount({ duration: 'forever', percent_off: 20 })],
				}),
				cloudSubscription({
					id: 'sub_eur',
					customer: 'cus_eur',
					status: 'active',
					currency: 'eur',
					discounts: [discount({ duration: 'repeating', amount_off: 30_000, currency: 'eur' })],
				}),
			],
			trialing: [
				cloudSubscription({
					id: 'sub_trial',
					currency: 'usd',
					discounts: [discount({ duration: 'once', percent_off: 100 })],
				}),
			],
		};
		stripeMocks.listSubscriptions.mockImplementation(({ status }: Stripe.SubscriptionListParams) =>
			paginatedList(subscriptionsByStatus[status ?? ''] ?? []),
		);
		stripeMocks.retrievePrice.mockResolvedValue({ currency_options: { eur: { unit_amount: 180_000 } } });

		await expect(listCurrentCloudSubscriptions()).resolves.toEqual([
			{
				id: 'sub_yearly',
				stripeCustomerId: 'cus_cloud',
				status: 'active',
				currency: 'usd',
				monthlyAmount: 133_333,
			},
			{ id: 'sub_eur', stripeCustomerId: 'cus_eur', status: 'active', currency: 'eur', monthlyAmount: 150_000 },
			{
				id: 'sub_trial',
				stripeCustomerId: 'cus_cloud',
				status: 'trialing',
				currency: 'usd',
				monthlyAmount: 200_000,
			},
		]);
		expect(stripeMocks.retrievePrice).toHaveBeenCalledWith('price_cloud_monthly', { expand: ['currency_options'] });
	});
});

function discount(coupon: Partial<Stripe.Coupon>): Stripe.Discount {
	return {
		end: null,
		source: { type: 'coupon', coupon: { amount_off: null, currency: null, percent_off: null, ...coupon } },
	} as Stripe.Discount;
}

function cloudMonthlyPrice(overrides: Partial<Stripe.Price> = {}): Stripe.Price {
	const price = {
		active: true,
		billing_scheme: 'per_unit',
		currency: 'usd',
		currency_options: {
			eur: { unit_amount: 200_000 },
		},
		id: 'price_cloud_monthly',
		lookup_key: 'nao_cloud_monthly_v2',
		object: 'price',
		product: cloudProduct(),
		recurring: recurring(),
		type: 'recurring',
		unit_amount: 200_000,
		...overrides,
	} as Stripe.Price;
	if (!overrides.currency_options && price.currency_options?.eur) {
		price.currency_options.eur.unit_amount = price.unit_amount;
	}
	return price;
}

function cloudYearlyPrice(overrides: Partial<Stripe.Price> = {}): Stripe.Price {
	return cloudMonthlyPrice({
		id: 'price_cloud_yearly',
		lookup_key: 'yearly_sub',
		recurring: recurring({ interval: 'year' }),
		unit_amount: 2_000_000,
		...overrides,
	});
}

function teamMonthlyPrice(overrides: Partial<Stripe.Price> = {}): Stripe.Price {
	return cloudMonthlyPrice({
		id: 'price_team_monthly',
		lookup_key: 'configured_team_monthly',
		product: cloudProduct({ id: 'prod_team' }),
		unit_amount: 5_000,
		...overrides,
	});
}

function teamYearlyPrice(overrides: Partial<Stripe.Price> = {}): Stripe.Price {
	return cloudMonthlyPrice({
		id: 'price_team_yearly',
		lookup_key: 'configured_team_yearly',
		product: cloudProduct({ id: 'prod_team' }),
		recurring: recurring({ interval: 'year' }),
		unit_amount: 50_000,
		...overrides,
	});
}

function unlimitedMonthlyPrice(overrides: Partial<Stripe.Price> = {}): Stripe.Price {
	return cloudMonthlyPrice({
		id: 'price_unlimited_monthly',
		lookup_key: 'configured_unlimited_monthly',
		product: cloudProduct({ id: 'prod_unlimited' }),
		unit_amount: 200_000,
		...overrides,
	});
}

function unlimitedYearlyPrice(overrides: Partial<Stripe.Price> = {}): Stripe.Price {
	return cloudMonthlyPrice({
		id: 'price_unlimited_yearly',
		lookup_key: 'configured_unlimited_yearly',
		product: cloudProduct({ id: 'prod_unlimited' }),
		recurring: recurring({ interval: 'year' }),
		unit_amount: 2_000_000,
		...overrides,
	});
}

function priceForLookupKey(lookupKey: string | undefined): Stripe.Price {
	switch (lookupKey) {
		case 'nao_trial':
			return cloudTrialPrice();
		case 'yearly_sub':
			return cloudYearlyPrice();
		case 'configured_team_monthly':
			return teamMonthlyPrice();
		case 'configured_team_yearly':
			return teamYearlyPrice();
		case 'configured_unlimited_monthly':
			return unlimitedMonthlyPrice();
		case 'configured_unlimited_yearly':
			return unlimitedYearlyPrice();
		default:
			return cloudMonthlyPrice();
	}
}

function cloudTrialPrice(overrides: Partial<Stripe.Price> = {}): Stripe.Price {
	return cloudMonthlyPrice({
		currency_options: undefined,
		id: 'price_cloud_trial',
		lookup_key: 'nao_trial',
		product: cloudProduct({ id: 'prod_cloud_trial' }),
		unit_amount: 0,
		...overrides,
	});
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
		currency: 'usd',
		customer: 'cus_cloud',
		discounts: [],
		id: 'sub_cloud',
		items: {
			data: [
				{
					id: 'si_cloud',
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

function cloudSubscriptionSchedule(overrides: Partial<Stripe.SubscriptionSchedule> = {}): Stripe.SubscriptionSchedule {
	return {
		id: 'sub_sched_team',
		status: 'active',
		phases: [
			schedulePhase(1_799_000_000, 1_800_000_000, unlimitedMonthlyPrice(), 1),
			schedulePhase(1_800_000_000, 1_802_592_000, teamMonthlyPrice(), 4),
		],
		...overrides,
	} as Stripe.SubscriptionSchedule;
}

function schedulePhase(
	startDate: number,
	endDate: number,
	price: Stripe.Price,
	quantity: number,
): Stripe.SubscriptionSchedule.Phase {
	return {
		start_date: startDate,
		end_date: endDate,
		items: [{ price, quantity }],
	} as Stripe.SubscriptionSchedule.Phase;
}

function paidCreditTopUpSession(input: { platformFeeCents: number; amount_subtotal: number; amount_total: number }) {
	return {
		id: 'cs_top_up',
		mode: 'payment',
		payment_status: 'paid',
		currency: 'usd',
		customer: 'cus_cloud',
		client_reference_id: 'org-id',
		payment_intent: 'pi_top_up',
		invoice: 'in_top_up',
		metadata: {
			nao_checkout_kind: 'credit_top_up',
			nao_org_id: 'org-id',
			nao_initiating_user_id: 'user-id',
			nao_credit_amount_cents: '2000',
			nao_wallet_amount_micro_usd: '20000000',
			nao_platform_fee_cents: String(input.platformFeeCents),
		},
		amount_subtotal: input.amount_subtotal,
		amount_total: input.amount_total,
		total_details: { amount_discount: 0, amount_tax: 200 },
		line_items: {
			data: [
				{ quantity: 1, currency: 'usd', amount_subtotal: 2_000, price: { product: 'prod_credits' } },
				{
					quantity: 1,
					currency: 'usd',
					amount_subtotal: input.platformFeeCents,
					price: { product: 'prod_platform_fee' },
				},
			],
		},
	};
}

function cloudTrialSubscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
	const subscription = cloudSubscription({
		id: 'sub_cloud_trial',
		metadata: { nao_org_id: 'org-id', nao_subscription_kind: 'trial-placeholder' },
		...overrides,
	});
	subscription.items.data[0].price = cloudTrialPrice();
	return subscription;
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
