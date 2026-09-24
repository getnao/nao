import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
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
	listUserOrgMemberships: vi.fn(async () => (testState.membership ? [testState.membership] : [])),
}));

vi.mock('../src/queries/billing.queries', () => ({
	attachStripeCustomer: stripeMocks.attachCustomer,
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

describe('billing.getStatus', () => {
	beforeEach(() => {
		testState.billingEnabled = true;
		testState.membership = null;
		vi.clearAllMocks();
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
				amount: 200_000,
				currency: 'eur',
			},
			planKey: 'cloud_monthly_v2',
			status: 'trialing',
			trialEndsAt,
			hasDefaultPaymentMethod: true,
			canManageBilling: true,
			hasStripeSubscription: false,
			localTrialActive: true,
		});
	});

	it('does not invent a plan for an uninitialized organization', async () => {
		testState.membership = membership({});

		await expect(caller().billing.getStatus()).resolves.toMatchObject({
			plan: null,
			planKey: null,
			status: null,
		});
	});

	it('uses the selected project organization', async () => {
		testState.membership = membership({ billingStatus: 'active' });

		await expect(caller('project-id').billing.getStatus()).resolves.toMatchObject({ status: 'active' });
		expect(orgQueries.getUserOrgMembershipByProject).toHaveBeenCalledWith('user-id', 'project-id');
		expect(orgQueries.listUserOrgMemberships).not.toHaveBeenCalled();
	});

	it('rejects an unknown selected project instead of choosing another organization', async () => {
		testState.membership = membership({ billingStatus: 'active' });
		vi.mocked(orgQueries.getUserOrgMembershipByProject).mockResolvedValueOnce(null);

		await expect(caller('stale-project-id').billing.getStatus()).rejects.toMatchObject({ code: 'NOT_FOUND' });
		expect(orgQueries.listUserOrgMemberships).not.toHaveBeenCalled();
	});

	it('requires a project when organization membership is ambiguous', async () => {
		testState.membership = membership({});
		vi.mocked(orgQueries.listUserOrgMemberships).mockResolvedValueOnce([
			testState.membership,
			membership({}),
		] as never);

		await expect(caller().billing.getStatus()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
	});

	it('is unavailable without querying an organization when cloud billing is disabled', async () => {
		testState.billingEnabled = false;

		await expect(caller().billing.getStatus()).rejects.toMatchObject({ code: 'NOT_FOUND' });
		expect(orgQueries.listUserOrgMemberships).not.toHaveBeenCalled();
	});
});

describe('billing.createCheckoutSession', () => {
	beforeEach(() => {
		testState.billingEnabled = true;
		testState.membership = membership({
			billingPlan: 'cloud_monthly_v2',
			billingStatus: 'trialing',
			trialStartedAt: new Date('2026-09-24T00:00:00.000Z'),
			trialEndsAt: new Date('2026-10-08T00:00:00.000Z'),
		});
		vi.clearAllMocks();
		stripeMocks.createCustomer.mockResolvedValue({ id: 'cus_cloud' });
		stripeMocks.attachCustomer.mockResolvedValue({
			...(testState.membership as { organization: Record<string, unknown> }).organization,
			stripeCustomerId: 'cus_cloud',
		});
		stripeMocks.createCheckout.mockResolvedValue('https://checkout.stripe.com/session');
	});

	it('creates a server-owned cardless Checkout URL for an organization admin', async () => {
		await expect(caller().billing.createCheckoutSession()).resolves.toEqual({
			url: 'https://checkout.stripe.com/session',
		});

		expect(stripeService.createCloudCustomer).toHaveBeenCalledWith({
			organizationId: 'org-id',
			organizationName: 'Test Organization',
			adminEmail: 'admin@example.com',
		});
		expect(stripeService.createCloudCheckoutSession).toHaveBeenCalledWith({
			organizationId: 'org-id',
			stripeCustomerId: 'cus_cloud',
			trialEndsAt: new Date('2026-10-08T00:00:00.000Z'),
		});
	});

	it('rejects non-admin members before Stripe work', async () => {
		testState.membership = membership({}, 'member');

		await expect(caller().billing.createCheckoutSession()).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(stripeService.createCloudCustomer).not.toHaveBeenCalled();
	});

	it('rejects Checkout when a Stripe subscription already exists', async () => {
		testState.membership = membership({ stripeSubscriptionId: 'sub_cloud' });

		await expect(caller().billing.createCheckoutSession()).rejects.toMatchObject({ code: 'CONFLICT' });
		expect(stripeService.createCloudCustomer).not.toHaveBeenCalled();
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
		stripeMocks.createPortal.mockResolvedValue('https://billing.stripe.com/session');
		stripeMocks.createPaymentMethod.mockResolvedValue('https://billing.stripe.com/payment-method');
		stripeMocks.createResubscribe.mockResolvedValue('https://checkout.stripe.com/subscription');
		stripeMocks.listInvoices.mockResolvedValue([{ id: 'in_cloud' }]);
		stripeMocks.resumeSubscription.mockResolvedValue({});
	});

	it('returns the organization Customer invoice history to admins', async () => {
		await expect(caller().billing.getInvoices()).resolves.toEqual([{ id: 'in_cloud' }]);
		expect(stripeService.listCloudInvoices).toHaveBeenCalledWith('cus_cloud');
	});

	it('rejects invoice history access for non-admin members', async () => {
		testState.membership = membership({ stripeCustomerId: 'cus_cloud' }, 'member');

		await expect(caller().billing.getInvoices()).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(stripeService.listCloudInvoices).not.toHaveBeenCalled();
	});

	it('returns only the hosted Customer Portal URL', async () => {
		await expect(
			caller().billing.createPortalSession({ requestId: 'c7cc1630-972f-4e2a-a412-9ef6c0e59ef9' }),
		).resolves.toEqual({ url: 'https://billing.stripe.com/session' });
	});

	it('returns a trusted payment-method management URL', async () => {
		await expect(
			caller().billing.createPaymentMethodSession({ requestId: 'c7cc1630-972f-4e2a-a412-9ef6c0e59ef9' }),
		).resolves.toEqual({ url: 'https://billing.stripe.com/payment-method' });
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

function caller(selectedProjectId: string | null = null) {
	return testRouter.createCaller({
		session: {
			user: { id: 'user-id', name: 'Admin', email: 'admin@example.com' },
			session: { token: 'session-token' },
		},
		selectedProjectId,
	} as never);
}

function membership(organization: Record<string, unknown>, role = 'admin') {
	return {
		orgId: 'org-id',
		userId: 'user-id',
		role,
		createdAt: new Date(),
		organization: {
			id: 'org-id',
			name: 'Test Organization',
			billingPlan: null,
			billingStatus: null,
			trialStartedAt: null,
			trialEndsAt: null,
			stripeCustomerId: null,
			stripeSubscriptionId: null,
			currentPeriodEndsAt: null,
			cancelAtPeriodEnd: null,
			hasDefaultPaymentMethod: null,
			billingAccessEndsAt: null,
			billingUpdatedAt: null,
			...organization,
		},
	};
}
