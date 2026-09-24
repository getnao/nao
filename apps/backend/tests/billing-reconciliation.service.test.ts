import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	attachCustomer: vi.fn(),
	claimSync: vi.fn(),
	getOrganizationByCustomer: vi.fn(),
	getOrganizationById: vi.fn(),
	hasDefaultPaymentMethod: vi.fn(),
	listSubscriptions: vi.fn(),
	subscriptionProjection: vi.fn(),
	updatePaymentMethod: vi.fn(),
	updateSubscription: vi.fn(),
}));

vi.mock('../src/queries/billing.queries', () => ({
	attachStripeCustomer: mocks.attachCustomer,
	claimBillingSync: mocks.claimSync,
	getOrganizationByStripeCustomerId: mocks.getOrganizationByCustomer,
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

import { reconcileCloudBillingCustomer } from '../src/services/billing-reconciliation.service';

describe('cloud billing reconciliation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		const organization = buildOrganization();
		mocks.getOrganizationByCustomer.mockResolvedValue(organization);
		mocks.claimSync.mockResolvedValue({ organization, token: 'sync-token' });
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

	it('selects the newest terminal subscription when no current subscription exists', async () => {
		mocks.listSubscriptions.mockResolvedValue([
			buildSubscription({ id: 'sub_newer', status: 'canceled', created: 20 }),
			buildSubscription({ id: 'sub_old', status: 'canceled', created: 10 }),
		]);

		await reconcileCloudBillingCustomer({ stripeCustomerId: 'cus_cloud' });

		expect(mocks.subscriptionProjection).toHaveBeenCalledWith(expect.objectContaining({ id: 'sub_newer' }));
	});

	it('fails closed when Stripe has multiple current subscriptions', async () => {
		mocks.listSubscriptions.mockResolvedValue([
			buildSubscription({ id: 'sub_one', status: 'active' }),
			buildSubscription({ id: 'sub_two', status: 'trialing' }),
		]);

		await expect(reconcileCloudBillingCustomer({ stripeCustomerId: 'cus_cloud' })).rejects.toThrow(
			'multiple current cloud subscriptions',
		);
		expect(mocks.updateSubscription).not.toHaveBeenCalled();
	});

	it('uses live subscription metadata when attaching an unmapped Customer', async () => {
		const organization = buildOrganization({ stripeCustomerId: null });
		mocks.getOrganizationByCustomer.mockResolvedValue(null);
		mocks.getOrganizationById.mockResolvedValue(organization);
		mocks.attachCustomer.mockResolvedValue(buildOrganization());
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
		mocks.getOrganizationByCustomer.mockResolvedValue(null);
		mocks.listSubscriptions.mockResolvedValue([]);

		await expect(reconcileCloudBillingCustomer({ stripeCustomerId: 'cus_unrelated' })).resolves.toEqual({
			applied: false,
			ignored: true,
		});
		expect(mocks.claimSync).not.toHaveBeenCalled();
	});

	it('retries when a concurrent reconciliation supersedes its sync token', async () => {
		mocks.listSubscriptions.mockResolvedValue([buildSubscription()]);
		mocks.updateSubscription.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

		await expect(reconcileCloudBillingCustomer({ stripeCustomerId: 'cus_cloud' })).resolves.toEqual({
			applied: true,
			ignored: false,
		});

		expect(mocks.claimSync).toHaveBeenCalledTimes(2);
		expect(mocks.listSubscriptions).toHaveBeenCalledTimes(2);
	});
});

function buildOrganization(overrides: Record<string, unknown> = {}) {
	return {
		id: 'org-id',
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
