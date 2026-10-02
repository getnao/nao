import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
	billing: null as Record<string, unknown> | null,
	billingEnabled: true,
	membership: null as Record<string, unknown> | null,
}));
const stripeMocks = vi.hoisted(() => ({
	attachCustomer: vi.fn(),
	createCheckout: vi.fn(),
	createCustomer: vi.fn(),
	createPaymentMethod: vi.fn(),
	createPortal: vi.fn(),
	createResubscribe: vi.fn(),
	getBillingPlans: vi.fn(),
	getUpcomingInvoice: vi.fn(),
	listInvoices: vi.fn(),
	reconcileCustomer: vi.fn(),
	resumeSubscription: vi.fn(),
}));

vi.mock('../src/auth', () => ({
	getSession: vi.fn(async () => null),
}));

vi.mock('../src/queries/project.queries', () => ({}));

vi.mock('../src/queries/organization.queries', () => ({
	getUserOrgMembershipByProject: vi.fn(async () => testState.membership),
	getUserOrgMembership: vi.fn(async () => testState.membership),
	getOrgMember: vi.fn(async () => testState.membership),
	getOrganizationById: vi.fn(async () => testState.membership?.organization ?? null),
}));

vi.mock('../src/queries/user.queries', () => ({
	getUser: vi.fn(async () => ({ id: 'user-id', email: 'admin@example.com' })),
}));

vi.mock('../src/queries/billing.queries', () => ({
	attachStripeCustomer: stripeMocks.attachCustomer,
	getOrganizationBilling: vi.fn(async () => testState.billing),
}));

vi.mock('../src/services/billing-reconciliation.service', () => ({
	reconcileCloudBillingCustomer: stripeMocks.reconcileCustomer,
}));

vi.mock('../src/services/stripe.service', () => ({
	CloudSubscriptionUnavailableError: class extends Error {},
	CloudSubscriptionResumeError: class extends Error {},
	CloudInitialCheckoutUnavailableError: class extends Error {},
	createCloudCheckoutSession: stripeMocks.createCheckout,
	createCloudCustomer: stripeMocks.createCustomer,
	createCloudPaymentMethodSession: stripeMocks.createPaymentMethod,
	createCloudPortalSession: stripeMocks.createPortal,
	createCloudResubscribeSession: stripeMocks.createResubscribe,
	getCloudBillingPlans: stripeMocks.getBillingPlans,
	getCloudUpcomingInvoice: stripeMocks.getUpcomingInvoice,
	listCloudInvoices: stripeMocks.listInvoices,
	resumeCloudSubscription: stripeMocks.resumeSubscription,
}));

vi.mock('../src/services/sso-group-mapping.service', () => ({
	isGroupRoleMappingActive: vi.fn(async () => false),
}));

vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn() },
}));

vi.mock('../src/env', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/env')>()),
	isCloudBillingEnabled: vi.fn(() => testState.billingEnabled),
}));

import * as orgQueries from '../src/queries/organization.queries';
import * as stripeService from '../src/services/stripe.service';
import { billingRoutes } from '../src/trpc/billing.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router({ billing: billingRoutes });

describe('billing.getAccess', () => {
	beforeEach(() => {
		testState.billing = null;
		testState.billingEnabled = true;
		testState.membership = null;
		vi.clearAllMocks();
	});

	it('returns minimal entitlement state to organization members', async () => {
		const trialEndsAt = new Date('2099-10-05T00:00:00.000Z');
		testState.membership = membership(
			{ billingStatus: 'trialing', stripeSubscriptionId: 'sub_trial', trialEndsAt },
			'member',
		);

		await expect(caller().billing.getAccess()).resolves.toEqual({
			organizationId: 'org-id',
			hasAccess: true,
			status: 'trialing',
			trialEndsAt,
			canManageBilling: false,
			trialAvailable: false,
			requiresBillingAction: true,
		});
	});

	it('reports an expired trial as restricted', async () => {
		testState.membership = membership({
			billingStatus: 'trialing',
			trialEndsAt: new Date('2020-10-05T00:00:00.000Z'),
		});

		await expect(caller().billing.getAccess()).resolves.toMatchObject({
			hasAccess: false,
			canManageBilling: true,
		});
	});

	it('uses the active project organization before the stored organization selection', async () => {
		testState.membership = membership({ billingStatus: 'active' });

		await expect(caller('project-id', 'organization-id').billing.getAccess()).resolves.toMatchObject({
			status: 'active',
		});
		expect(orgQueries.getUserOrgMembershipByProject).toHaveBeenCalledWith('user-id', 'project-id');
		expect(orgQueries.getUserOrgMembership).not.toHaveBeenCalled();
	});
});

describe('billing.getStatus', () => {
	beforeEach(() => {
		testState.billing = null;
		testState.billingEnabled = true;
		testState.membership = null;
		vi.clearAllMocks();
		stripeMocks.getBillingPlans.mockResolvedValue({
			availablePlan: cloudPlan(250_000),
			subscriptionPlan: null,
		});
	});

	it('returns the organization billing projection and matching plan', async () => {
		const trialEndsAt = new Date('2026-10-05T00:00:00.000Z');
		testState.membership = membership({
			billingPlan: 'cloud_monthly_v2',
			billingStatus: 'trialing',
			hasDefaultPaymentMethod: true,
			trialEndsAt,
		});
		await expect(caller().billing.getStatus()).resolves.toMatchObject({
			plan: {
				key: 'cloud_monthly_v2',
				name: 'nao Cloud',
				amount: 250_000,
				currency: 'usd',
			},
			planKey: 'cloud_monthly_v2',
			status: 'trialing',
			trialEndsAt,
			hasDefaultPaymentMethod: true,
			canManageBilling: true,
			hasStripeSubscription: false,
			resubscribeAvailable: true,
			trialAvailable: false,
		});
	});

	it("returns an existing subscription's historical Price separately from the current offer", async () => {
		testState.membership = membership({
			billingPlan: 'cloud_monthly_v2',
			billingStatus: 'active',
			stripePriceId: 'price_legacy',
			stripeSubscriptionId: 'sub_cloud',
		});
		stripeMocks.getBillingPlans.mockResolvedValue({
			availablePlan: cloudPlan(250_000),
			subscriptionPlan: cloudPlan(200_000),
		});

		await expect(caller().billing.getStatus()).resolves.toMatchObject({
			plan: { amount: 200_000 },
			availablePlan: { amount: 250_000 },
		});
		expect(stripeMocks.getBillingPlans).toHaveBeenCalledWith('price_legacy');
	});

	it('does not invent a plan for an uninitialized organization', async () => {
		testState.membership = membership({});

		await expect(caller().billing.getStatus()).resolves.toMatchObject({
			plan: null,
			planKey: null,
			status: null,
			trialAvailable: true,
		});
	});

	it('uses the selected project organization', async () => {
		testState.membership = membership({ billingStatus: 'active' });

		await expect(caller('project-id').billing.getStatus()).resolves.toMatchObject({ status: 'active' });
		expect(orgQueries.getUserOrgMembershipByProject).toHaveBeenCalledWith('user-id', 'project-id');
		expect(orgQueries.getUserOrgMembership).not.toHaveBeenCalled();
	});

	it('prefers the explicitly selected organization over the active project', async () => {
		testState.membership = membership({ billingStatus: 'active' });

		await expect(caller('project-id', 'organization-id').billing.getStatus()).resolves.toMatchObject({
			status: 'active',
		});
		expect(orgQueries.getUserOrgMembership).toHaveBeenCalledWith('user-id', 'organization-id');
		expect(orgQueries.getUserOrgMembershipByProject).not.toHaveBeenCalled();
	});

	it('hides Stripe configuration errors from the client', async () => {
		testState.membership = membership({ billingStatus: 'active' });
		stripeMocks.getBillingPlans.mockRejectedValueOnce(new Error('Invalid API Key provided: sk_live_****1234'));

		await expect(caller().billing.getStatus()).rejects.toMatchObject({
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Unable to load billing plans',
		});
	});

	it('rejects non-admin members', async () => {
		testState.membership = membership({}, 'member');

		await expect(caller().billing.getStatus()).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});

	it('rejects an unknown selected project instead of choosing another organization', async () => {
		testState.membership = membership({ billingStatus: 'active' });
		vi.mocked(orgQueries.getUserOrgMembershipByProject).mockResolvedValueOnce(null);

		await expect(caller('stale-project-id').billing.getStatus()).rejects.toMatchObject({ code: 'NOT_FOUND' });
		expect(orgQueries.getUserOrgMembership).not.toHaveBeenCalled();
	});

	it('rejects an unknown selected organization instead of choosing another organization', async () => {
		testState.membership = membership({ billingStatus: 'active' });
		vi.mocked(orgQueries.getUserOrgMembership).mockResolvedValueOnce(null);

		await expect(caller(null, 'stale-organization-id').billing.getStatus()).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
		expect(stripeMocks.getBillingPlans).not.toHaveBeenCalled();
	});

	it('returns not found before authentication when cloud billing is disabled', async () => {
		testState.billingEnabled = false;

		await expect(anonymousCaller().billing.getStatus()).rejects.toMatchObject({ code: 'NOT_FOUND' });
		expect(orgQueries.getUserOrgMembership).not.toHaveBeenCalled();
	});
});

describe('billing.createTrialCheckoutSession', () => {
	beforeEach(() => {
		testState.billingEnabled = true;
		testState.membership = membership({});
		vi.clearAllMocks();
		stripeMocks.createCustomer.mockResolvedValue({ id: 'cus_cloud' });
		stripeMocks.attachCustomer.mockResolvedValue({
			orgId: 'org-id',
			stripeCustomerId: 'cus_cloud',
		});
		stripeMocks.createCheckout.mockResolvedValue('https://checkout.stripe.com/trial');
	});

	it('opens a Stripe trial Checkout without granting local access first', async () => {
		await expect(caller().billing.createTrialCheckoutSession()).resolves.toEqual({
			url: 'https://checkout.stripe.com/trial',
		});
		expect(stripeMocks.createCheckout).toHaveBeenCalledWith({
			organizationId: 'org-id',
			stripeCustomerId: 'cus_cloud',
			trialDays: 14,
		});
	});

	it('rejects non-admin members before creating Stripe trial objects', async () => {
		testState.membership = membership({}, 'member');

		await expect(caller().billing.createTrialCheckoutSession()).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(stripeMocks.createCustomer).not.toHaveBeenCalled();
		expect(stripeMocks.createCheckout).not.toHaveBeenCalled();
	});

	it('does not offer a second trial after one has started', async () => {
		testState.membership = membership({
			billingStatus: 'trialing',
			trialStartedAt: new Date('2026-09-24T00:00:00.000Z'),
			trialEndsAt: new Date('2026-10-08T00:00:00.000Z'),
		});

		await expect(caller().billing.createTrialCheckoutSession()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(stripeMocks.createCustomer).not.toHaveBeenCalled();
		expect(stripeMocks.createCheckout).not.toHaveBeenCalled();
	});
});

describe('billing management mutations', () => {
	beforeEach(() => {
		testState.billingEnabled = true;
		testState.membership = membership({
			stripeCustomerId: 'cus_cloud',
			stripeSubscriptionId: 'sub_cloud',
		});
		vi.clearAllMocks();
		stripeMocks.createResubscribe.mockResolvedValue('https://checkout.stripe.com/subscription');
		stripeMocks.resumeSubscription.mockResolvedValue({});
	});

	it('rejects invoice history access for non-admin members', async () => {
		testState.membership = membership({ stripeCustomerId: 'cus_cloud' }, 'member');

		await expect(caller().billing.getInvoices()).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(stripeService.listCloudInvoices).not.toHaveBeenCalled();
	});

	it('returns the next payment exactly as previewed by Stripe', async () => {
		const preview = {
			amountDue: 100_000,
			currency: 'usd',
			nextPaymentAt: new Date('2026-10-08T00:00:00.000Z'),
			promotionCodes: ['EARLY50'],
		};
		stripeMocks.getUpcomingInvoice.mockResolvedValue(preview);

		await expect(caller().billing.getUpcomingInvoice()).resolves.toEqual(preview);
		expect(stripeService.getCloudUpcomingInvoice).toHaveBeenCalledWith('sub_cloud');
	});

	it('rejects next payment previews for non-admin members', async () => {
		testState.membership = membership({ stripeSubscriptionId: 'sub_cloud' }, 'member');

		await expect(caller().billing.getUpcomingInvoice()).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(stripeService.getCloudUpcomingInvoice).not.toHaveBeenCalled();
	});

	it('returns no upcoming invoice preview without a subscription', async () => {
		testState.membership = membership({ stripeCustomerId: 'cus_cloud' });

		await expect(caller().billing.getUpcomingInvoice()).resolves.toBeNull();
		expect(stripeService.getCloudUpcomingInvoice).not.toHaveBeenCalled();
	});

	it('syncs the persisted projection from current Stripe state', async () => {
		await expect(caller().billing.syncStripeBilling()).resolves.toEqual({ synced: true });
		expect(stripeMocks.reconcileCustomer).toHaveBeenCalledWith({
			stripeCustomerId: 'cus_cloud',
			organizationIdHint: 'org-id',
		});
	});

	it('reports that no Stripe sync occurred without a Customer', async () => {
		testState.membership = membership({});

		await expect(caller().billing.syncStripeBilling()).resolves.toEqual({ synced: false });
		expect(stripeMocks.reconcileCustomer).not.toHaveBeenCalled();
	});

	it('starts a paid subscription Checkout only after a terminal subscription', async () => {
		testState.membership = membership({
			billingStatus: 'canceled',
			stripeCustomerId: 'cus_cloud',
			stripeSubscriptionId: 'sub_cloud',
		});

		await expect(caller().billing.createResubscribeSession()).resolves.toEqual({
			url: 'https://checkout.stripe.com/subscription',
		});
		expect(stripeService.createCloudResubscribeSession).toHaveBeenCalledWith({
			organizationId: 'org-id',
			stripeCustomerId: 'cus_cloud',
			allowMissingHistory: false,
		});
	});

	it('rejects subscription history without its Stripe Customer', async () => {
		testState.membership = membership({
			billingStatus: 'canceled',
			stripeSubscriptionId: 'sub_cloud',
		});

		await expect(caller().billing.createResubscribeSession()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(stripeMocks.createCustomer).not.toHaveBeenCalled();
		expect(stripeMocks.createResubscribe).not.toHaveBeenCalled();
	});

	it('starts a paid recovery Checkout when the trial was recorded without a subscription', async () => {
		testState.membership = membership({
			billingStatus: 'trialing',
			trialStartedAt: new Date('2026-09-24T00:00:00.000Z'),
			trialEndsAt: new Date('2026-10-08T00:00:00.000Z'),
		});
		stripeMocks.createCustomer.mockResolvedValue({ id: 'cus_recovery' });
		stripeMocks.attachCustomer.mockResolvedValue({
			orgId: 'org-id',
			stripeCustomerId: 'cus_recovery',
		});

		await expect(caller().billing.createResubscribeSession()).resolves.toEqual({
			url: 'https://checkout.stripe.com/subscription',
		});
		expect(stripeService.createCloudResubscribeSession).toHaveBeenCalledWith({
			organizationId: 'org-id',
			stripeCustomerId: 'cus_recovery',
			allowMissingHistory: true,
		});
	});

	it('rejects a second Checkout while the subscription is current', async () => {
		testState.membership = membership({
			billingStatus: 'active',
			stripeCustomerId: 'cus_cloud',
			stripeSubscriptionId: 'sub_cloud',
		});

		await expect(caller().billing.createResubscribeSession()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(stripeService.createCloudResubscribeSession).not.toHaveBeenCalled();
	});

	it('requests an idempotent paused-subscription resume', async () => {
		await expect(
			caller().billing.resumeSubscription({ requestId: 'c7cc1630-972f-4e2a-a412-9ef6c0e59ef9' }),
		).resolves.toEqual({ pending: true });
		expect(stripeService.resumeCloudSubscription).toHaveBeenCalledWith({
			organizationId: 'org-id',
			stripeSubscriptionId: 'sub_cloud',
			requestId: 'c7cc1630-972f-4e2a-a412-9ef6c0e59ef9',
		});
	});
});

function caller(selectedProjectId: string | null = null, selectedOrganizationId: string | null = null) {
	return testRouter.createCaller({
		session: {
			user: { id: 'user-id', name: 'Admin', email: 'admin@example.com' },
			session: { token: 'session-token' },
		},
		selectedProjectId,
		selectedOrganizationId,
	} as never);
}

function anonymousCaller() {
	return testRouter.createCaller({ session: null, selectedProjectId: null } as never);
}

function membership(organization: Record<string, unknown>, role = 'admin') {
	testState.billing =
		Object.keys(organization).length === 0
			? null
			: {
					orgId: 'org-id',
					billingPlan: null,
					billingStatus: null,
					trialStartedAt: null,
					trialEndsAt: null,
					stripeCustomerId: null,
					stripeSubscriptionId: null,
					stripePriceId: null,
					currentPeriodEndsAt: null,
					cancellationScheduled: null,
					hasDefaultPaymentMethod: null,
					billingAccessEndsAt: null,
					billingUpdatedAt: null,
					billingSyncToken: null,
					...organization,
				};
	return {
		orgId: 'org-id',
		userId: 'user-id',
		role,
		createdAt: new Date(),
		organization: {
			id: 'org-id',
			name: 'Test Organization',
		},
	};
}

function cloudPlan(amount: number) {
	return {
		key: 'cloud_monthly_v2',
		name: 'nao Cloud',
		amount,
		currency: 'usd',
		interval: 'month',
		intervalCount: 1,
		trialDays: 14,
		userLimit: null,
	};
}
