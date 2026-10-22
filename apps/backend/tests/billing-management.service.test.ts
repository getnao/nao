import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertAccess: vi.fn(),
	getOrganizationWithBilling: vi.fn(),
	attachCustomer: vi.fn(),
	reconcileCustomer: vi.fn(),
	createCheckout: vi.fn(),
	createCreditTopUpCheckout: vi.fn(),
	createCustomer: vi.fn(),
	createPaymentMethod: vi.fn(),
	createPortal: vi.fn(),
	createResubscribe: vi.fn(),
	getUpcomingInvoice: vi.fn(),
	listInvoices: vi.fn(),
	resumeSubscription: vi.fn(),
}));

vi.mock('../src/queries/user.queries', () => ({
	getUser: vi.fn(),
}));

vi.mock('../src/queries/billing.queries', () => ({
	attachStripeCustomer: mocks.attachCustomer,
	getOrganizationWithBilling: mocks.getOrganizationWithBilling,
}));

vi.mock('../src/services/billing-reconciliation.service', () => ({
	reconcileCloudBillingCustomer: mocks.reconcileCustomer,
}));

vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertOrganizationCloudBillingAccess: mocks.assertAccess,
	isActiveTrialWithoutPaidPlan: (billing: { billingPlan?: string | null; billingStatus?: string } | null) =>
		billing?.billingPlan == null && billing?.billingStatus === 'trialing',
}));

vi.mock('../src/services/stripe.service', () => ({
	CloudInitialCheckoutUnavailableError: class extends Error {},
	createCloudCheckoutSession: mocks.createCheckout,
	createCreditTopUpCheckoutSession: mocks.createCreditTopUpCheckout,
	createCloudCustomer: mocks.createCustomer,
	createCloudPaymentMethodSession: mocks.createPaymentMethod,
	createCloudPortalSession: mocks.createPortal,
	createCloudResubscribeSession: mocks.createResubscribe,
	getCloudUpcomingInvoice: mocks.getUpcomingInvoice,
	listCloudInvoices: mocks.listInvoices,
	resumeCloudSubscription: mocks.resumeSubscription,
}));

import {
	createCloudResubscribeForAdmin,
	createCloudTrialCheckoutForAdmin,
	createCreditTopUpCheckoutForAdmin,
	getCloudBillingOrganizationForAdmin,
} from '../src/services/billing-management.service';

const adminInput = { userId: 'user-id', organizationId: 'org-id' };

describe('billing management organization loading', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns the joined organization and billing state', async () => {
		const organization = {
			id: 'org-id',
			name: 'Organization',
			billing: { orgId: 'org-id', billingStatus: 'active' },
		};
		mocks.getOrganizationWithBilling.mockResolvedValue(organization);

		await expect(getCloudBillingOrganizationForAdmin(adminInput)).resolves.toBe(organization);
		expect(mocks.getOrganizationWithBilling).toHaveBeenCalledWith('org-id');
	});

	it('rejects a missing organization', async () => {
		mocks.getOrganizationWithBilling.mockResolvedValue(null);

		await expect(getCloudBillingOrganizationForAdmin(adminInput)).rejects.toMatchObject({
			codeMessage: 'NOT_FOUND',
		});
	});

	it('allows credit top-ups after Cloud entitlement expires', async () => {
		mocks.getOrganizationWithBilling.mockResolvedValue({
			id: 'org-id',
			name: 'Organization',
			billing: {
				orgId: 'org-id',
				billingStatus: 'canceled',
				stripeCustomerId: 'cus_cloud',
			},
		});
		mocks.assertAccess.mockRejectedValue(new Error('Cloud billing access is restricted'));
		mocks.createCreditTopUpCheckout.mockResolvedValue('https://checkout.stripe.com/credits');

		await expect(
			createCreditTopUpCheckoutForAdmin({
				...adminInput,
				creditAmountCents: 2_000,
				requestId: 'request-id',
			}),
		).resolves.toBe('https://checkout.stripe.com/credits');
		expect(mocks.createCreditTopUpCheckout).toHaveBeenCalledWith({
			creditAmountCents: 2_000,
			organizationId: 'org-id',
			stripeCustomerId: 'cus_cloud',
			initiatingUserId: 'user-id',
			requestId: 'request-id',
		});
	});

	it('reconciles a Stripe Customer before allowing initial Checkout', async () => {
		mocks.getOrganizationWithBilling
			.mockResolvedValueOnce({
				id: 'org-id',
				name: 'Organization',
				billing: {
					billingPlan: null,
					billingStatus: 'trialing',
					stripeCustomerId: 'cus_cloud',
					stripeSubscriptionId: 'sub_placeholder',
					trialEndsAt: new Date('2099-01-15T00:00:00.000Z'),
					billingAccessEndsAt: new Date('2099-01-15T00:00:00.000Z'),
				},
			})
			.mockResolvedValueOnce({
				id: 'org-id',
				name: 'Organization',
				billing: {
					billingPlan: 'cloud_monthly_v2',
					billingStatus: 'active',
					stripeCustomerId: 'cus_cloud',
					stripeSubscriptionId: 'sub_paid',
				},
			});

		await expect(
			createCloudTrialCheckoutForAdmin({ ...adminInput, billingInterval: 'monthly', currency: 'usd' }),
		).rejects.toThrow('already used its free trial');

		expect(mocks.reconcileCustomer).toHaveBeenCalledWith({
			stripeCustomerId: 'cus_cloud',
			organizationIdHint: 'org-id',
		});
		expect(mocks.createCheckout).not.toHaveBeenCalled();
	});

	it('reconciles a Stripe Customer before allowing recovery Checkout', async () => {
		mocks.getOrganizationWithBilling
			.mockResolvedValueOnce({
				id: 'org-id',
				name: 'Organization',
				billing: {
					billingPlan: null,
					billingStatus: 'canceled',
					stripeCustomerId: 'cus_cloud',
					stripeSubscriptionId: 'sub_placeholder',
				},
			})
			.mockResolvedValueOnce({
				id: 'org-id',
				name: 'Organization',
				billing: {
					billingPlan: null,
					billingStatus: 'trialing',
					stripeCustomerId: 'cus_cloud',
					stripeSubscriptionId: 'sub_placeholder',
					trialEndsAt: new Date('2099-01-15T00:00:00.000Z'),
					billingAccessEndsAt: new Date('2099-01-15T00:00:00.000Z'),
				},
			});

		await expect(
			createCloudResubscribeForAdmin({ ...adminInput, billingInterval: 'monthly', currency: 'usd' }),
		).rejects.toThrow('A new subscription is not available');

		expect(mocks.reconcileCustomer).toHaveBeenCalledWith({
			stripeCustomerId: 'cus_cloud',
			organizationIdHint: 'org-id',
		});
		expect(mocks.createResubscribe).not.toHaveBeenCalled();
	});

	it('opens recovery Checkout after Stripe reports an expired placeholder as canceled', async () => {
		mocks.getOrganizationWithBilling
			.mockResolvedValueOnce({
				id: 'org-id',
				name: 'Organization',
				billing: {
					billingPlan: null,
					billingStatus: 'trialing',
					stripeCustomerId: 'cus_cloud',
					stripeSubscriptionId: 'sub_placeholder',
					trialEndsAt: new Date('2020-01-15T00:00:00.000Z'),
					billingAccessEndsAt: new Date('2020-01-15T00:00:00.000Z'),
				},
			})
			.mockResolvedValueOnce({
				id: 'org-id',
				name: 'Organization',
				billing: {
					billingPlan: null,
					billingStatus: 'canceled',
					stripeCustomerId: 'cus_cloud',
					stripeSubscriptionId: 'sub_placeholder',
				},
			});
		mocks.createResubscribe.mockResolvedValue('https://checkout.example.com');

		await expect(
			createCloudResubscribeForAdmin({ ...adminInput, billingInterval: 'monthly', currency: 'usd' }),
		).resolves.toBe('https://checkout.example.com');

		expect(mocks.createResubscribe).toHaveBeenCalledWith({
			allowMissingHistory: false,
			billingInterval: 'monthly',
			currency: 'usd',
			organizationId: 'org-id',
			stripeCustomerId: 'cus_cloud',
		});
	});
});
