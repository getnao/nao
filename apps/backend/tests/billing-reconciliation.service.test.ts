import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	attachCustomer: vi.fn(),
	claimSync: vi.fn(),
	getBillingByCustomer: vi.fn(),
	getOrganizationById: vi.fn(),
	hasDefaultPaymentMethod: vi.fn(),
	listSubscriptions: vi.fn(),
	logError: vi.fn(),
	subscriptionProjection: vi.fn(),
	updatePaymentMethod: vi.fn(),
	updateSubscription: vi.fn(),
}));

vi.mock('../src/queries/billing.queries', () => ({
	attachStripeCustomer: mocks.attachCustomer,
	claimBillingSync: mocks.claimSync,
	getOrganizationBillingByStripeCustomerId: mocks.getBillingByCustomer,
	updatePaymentMethodProjection: mocks.updatePaymentMethod,
	updateSubscriptionProjection: mocks.updateSubscription,
}));

vi.mock('../src/queries/organization.queries', () => ({
	getOrganizationById: mocks.getOrganizationById,
}));

vi.mock('../src/services/stripe.service', () => ({
	cloudSubscriptionProjection: mocks.subscriptionProjection,
	hasCloudDefaultPaymentMethod: mocks.hasDefaultPaymentMethod,
	listCloudSubscriptions: mocks.listSubscriptions,
}));

vi.mock('../src/utils/logger', () => ({
	logger: { error: mocks.logError },
}));

import { reconcileCloudBillingCustomer } from '../src/services/billing-reconciliation.service';

describe('cloud billing reconciliation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		const billing = buildBilling();
		mocks.getBillingByCustomer.mockResolvedValue(billing);
		mocks.claimSync.mockResolvedValue({ billing, token: 'sync-token' });
		mocks.hasDefaultPaymentMethod.mockResolvedValue(false);
		mocks.subscriptionProjection.mockResolvedValue({
			billingStatus: 'active',
			stripeCustomerId: 'cus_cloud',
			stripeSubscriptionId: 'sub_active',
			trialStartedAt: null,
			trialEndsAt: null,
		});
		mocks.updatePaymentMethod.mockResolvedValue(true);
		mocks.updateSubscription.mockResolvedValue(true);
	});

	it('discovers the current subscription from the Customer and preserves trial history', async () => {
		mocks.listSubscriptions.mockResolvedValue([
			buildSubscription({ id: 'sub_old', status: 'canceled', created: 10 }),
			buildSubscription({ id: 'sub_active', status: 'active', created: 20 }),
		]);

		await expect(
			reconcileCloudBillingCustomer({
				stripeCustomerId: 'cus_cloud',
				organizationIdHint: 'stale-event-org',
			}),
		).resolves.toEqual({ applied: true, ignored: false });

		expect(mocks.subscriptionProjection).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'sub_active', status: 'active' }),
		);
		expect(mocks.updateSubscription).toHaveBeenCalledWith(
			'org-id',
			'sync-token',
			expect.objectContaining({
				stripeSubscriptionId: 'sub_active',
				trialStartedAt: new Date('2026-01-01T00:00:00.000Z'),
				trialEndsAt: new Date('2026-01-15T00:00:00.000Z'),
			}),
		);
	});

	it('prefers live subscription trial dates over persisted history', async () => {
		const trialStartedAt = new Date('2026-02-01T00:00:00.000Z');
		const trialEndsAt = new Date('2026-02-15T00:00:00.000Z');
		mocks.listSubscriptions.mockResolvedValue([buildSubscription()]);
		mocks.subscriptionProjection.mockResolvedValue({
			billingStatus: 'trialing',
			stripeCustomerId: 'cus_cloud',
			stripeSubscriptionId: 'sub_active',
			trialStartedAt,
			trialEndsAt,
		});

		await reconcileCloudBillingCustomer({ stripeCustomerId: 'cus_cloud' });

		expect(mocks.updateSubscription).toHaveBeenCalledWith(
			'org-id',
			'sync-token',
			expect.objectContaining({ trialStartedAt, trialEndsAt }),
		);
	});

	it('selects the newest terminal subscription when no current subscription exists', async () => {
		mocks.listSubscriptions.mockResolvedValue([
			buildSubscription({ id: 'sub_newer', status: 'canceled', created: 20 }),
			buildSubscription({ id: 'sub_old', status: 'canceled', created: 10 }),
		]);

		await reconcileCloudBillingCustomer({ stripeCustomerId: 'cus_cloud' });

		expect(mocks.subscriptionProjection).toHaveBeenCalledWith(expect.objectContaining({ id: 'sub_newer' }));
	});

	it('prefers the persisted subscription and logs when Stripe has multiple current subscriptions', async () => {
		const billing = buildBilling({ stripeSubscriptionId: 'sub_old' });
		mocks.getBillingByCustomer.mockResolvedValue(billing);
		mocks.claimSync.mockResolvedValue({ billing, token: 'sync-token' });
		mocks.listSubscriptions.mockResolvedValue([
			buildSubscription({ id: 'sub_new', status: 'active', created: 10 }),
			buildSubscription({ id: 'sub_old', status: 'active', created: 20 }),
			buildSubscription({ id: 'sub_trial', status: 'trialing', created: 30 }),
		]);

		await expect(reconcileCloudBillingCustomer({ stripeCustomerId: 'cus_cloud' })).resolves.toEqual({
			applied: true,
			ignored: false,
		});

		expect(mocks.subscriptionProjection).toHaveBeenCalledWith(expect.objectContaining({ id: 'sub_old' }));
		expect(mocks.logError).toHaveBeenCalledWith(
			'Stripe Customer "cus_cloud" has multiple current cloud subscriptions',
			{
				source: 'system',
				context: {
					currentSubscriptionIds: ['sub_new', 'sub_old', 'sub_trial'],
					selectedSubscriptionId: 'sub_old',
				},
			},
		);
	});

	it('uses live subscription metadata when attaching an unmapped Customer', async () => {
		mocks.getBillingByCustomer.mockResolvedValue(null);
		mocks.getOrganizationById.mockResolvedValue({ id: 'org-id' });
		mocks.attachCustomer.mockResolvedValue(buildBilling());
		mocks.listSubscriptions.mockResolvedValue([
			buildSubscription({ metadata: { nao_org_id: 'org-id' }, status: 'active' }),
		]);

		await reconcileCloudBillingCustomer({
			stripeCustomerId: 'cus_cloud',
			organizationIdHint: 'stale-event-org',
		});

		expect(mocks.getOrganizationById).toHaveBeenCalledWith('org-id');
		expect(mocks.attachCustomer).toHaveBeenCalledWith('org-id', 'cus_cloud');
	});

	it('uses the organization hint when an unmapped Customer has no subscriptions', async () => {
		mocks.getBillingByCustomer.mockResolvedValue(null);
		mocks.getOrganizationById.mockResolvedValue({ id: 'org-id' });
		mocks.attachCustomer.mockResolvedValue(buildBilling());
		mocks.listSubscriptions.mockResolvedValue([]);

		await reconcileCloudBillingCustomer({
			stripeCustomerId: 'cus_cloud',
			organizationIdHint: 'org-id',
		});

		expect(mocks.getOrganizationById).toHaveBeenCalledWith('org-id');
		expect(mocks.attachCustomer).toHaveBeenCalledWith('org-id', 'cus_cloud');
	});

	it('updates only the payment-method projection when no cloud subscription exists', async () => {
		mocks.listSubscriptions.mockResolvedValue([]);
		mocks.hasDefaultPaymentMethod.mockResolvedValue(true);

		await expect(reconcileCloudBillingCustomer({ stripeCustomerId: 'cus_cloud' })).resolves.toEqual({
			applied: true,
			ignored: false,
		});

		expect(mocks.updatePaymentMethod).toHaveBeenCalledWith('org-id', 'sync-token', 'cus_cloud', true);
	});

	it('ignores an unrelated Stripe Customer without an organization or cloud subscription', async () => {
		mocks.getBillingByCustomer.mockResolvedValue(null);
		mocks.listSubscriptions.mockResolvedValue([]);

		await expect(reconcileCloudBillingCustomer({ stripeCustomerId: 'cus_unrelated' })).resolves.toEqual({
			applied: false,
			ignored: true,
		});
		expect(mocks.claimSync).not.toHaveBeenCalled();
	});

	it('yields to a concurrent reconciliation that superseded its sync token', async () => {
		mocks.listSubscriptions.mockResolvedValue([buildSubscription()]);
		mocks.updateSubscription.mockResolvedValue(false);

		await expect(reconcileCloudBillingCustomer({ stripeCustomerId: 'cus_cloud' })).resolves.toEqual({
			applied: false,
			ignored: false,
		});
	});
});

function buildBilling(overrides: Record<string, unknown> = {}) {
	return {
		orgId: 'org-id',
		stripeCustomerId: 'cus_cloud',
		stripeSubscriptionId: 'sub_old',
		trialStartedAt: new Date('2026-01-01T00:00:00.000Z'),
		trialEndsAt: new Date('2026-01-15T00:00:00.000Z'),
		...overrides,
	};
}

function buildSubscription(overrides: Record<string, unknown> = {}) {
	return {
		created: 1,
		customer: 'cus_cloud',
		id: 'sub_active',
		metadata: { nao_org_id: 'org-id' },
		status: 'active',
		...overrides,
	};
}
