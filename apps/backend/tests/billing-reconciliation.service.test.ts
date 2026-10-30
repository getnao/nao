import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	attachCustomer: vi.fn(),
	cancelPlaceholder: vi.fn(),
	claimSync: vi.fn(),
	claimSeatEmail: vi.fn(),
	getBillingByCustomer: vi.fn(),
	getOrganizationById: vi.fn(),
	hasDefaultPaymentMethod: vi.fn(),
	isCloudBillingEnabled: vi.fn(() => true),
	isCloudFreeTierEnabled: vi.fn(() => false),
	countOrgSeatUsers: vi.fn(),
	listOrgSeatCandidates: vi.fn(),
	listReadOnlyOrgUsers: vi.fn(),
	listSeatStates: vi.fn(),
	listSubscriptions: vi.fn(),
	logError: vi.fn(),
	subscriptionProjection: vi.fn(),
	syncOrganizationSeatState: vi.fn(),
	releaseSeatEmail: vi.fn(),
	updatePaymentMethod: vi.fn(),
	updatePaidTrialEnd: vi.fn(),
	updateSubscription: vi.fn(),
}));

vi.mock('../src/env', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/env')>()),
	isCloudBillingEnabled: mocks.isCloudBillingEnabled,
	isCloudFreeTierEnabled: mocks.isCloudFreeTierEnabled,
}));

vi.mock('../src/queries/billing.queries', () => ({
	attachStripeCustomer: mocks.attachCustomer,
	claimBillingSync: mocks.claimSync,
	getOrganizationBillingByStripeCustomerId: mocks.getBillingByCustomer,
	updatePaymentMethodProjection: mocks.updatePaymentMethod,
	updateSubscriptionProjection: mocks.updateSubscription,
}));

vi.mock('../src/queries/organization.queries', () => ({
	countOrgSeatUsers: mocks.countOrgSeatUsers,
	getOrganizationById: mocks.getOrganizationById,
	listOrgSeatCandidates: mocks.listOrgSeatCandidates,
	listReadOnlyOrgUsers: mocks.listReadOnlyOrgUsers,
}));

vi.mock('../src/queries/organization-seat-state.queries', () => ({
	claimOrganizationSeatEmailNotification: mocks.claimSeatEmail,
	listOrganizationSeatStates: mocks.listSeatStates,
	releaseOrganizationSeatEmailNotification: mocks.releaseSeatEmail,
	syncOrganizationSeatState: mocks.syncOrganizationSeatState,
}));

vi.mock('../src/queries/user.queries', () => ({
	getUsersByIds: vi.fn(async () => []),
}));

vi.mock('../src/services/stripe.service', () => ({
	cancelCloudTrialPlaceholderSubscription: mocks.cancelPlaceholder,
	cloudSubscriptionProjection: mocks.subscriptionProjection,
	hasCloudDefaultPaymentMethod: mocks.hasDefaultPaymentMethod,
	listCloudSubscriptions: async (...args: unknown[]) => {
		const subscriptions = await mocks.listSubscriptions(...args);
		return subscriptions.map((subscription: { metadata?: Record<string, string> }) => ({
			kind:
				subscription.metadata?.nao_subscription_kind === 'trial-placeholder'
					? 'trial-placeholder'
					: 'paid-cloud',
			subscription,
		}));
	},
	updateCloudPaidSubscriptionTrialEnd: mocks.updatePaidTrialEnd,
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
		mocks.claimSeatEmail.mockResolvedValue(false);
		mocks.hasDefaultPaymentMethod.mockResolvedValue(false);
		mocks.isCloudBillingEnabled.mockReturnValue(true);
		mocks.isCloudFreeTierEnabled.mockReturnValue(false);
		mocks.countOrgSeatUsers.mockResolvedValue(0);
		mocks.listOrgSeatCandidates.mockResolvedValue([]);
		mocks.listReadOnlyOrgUsers.mockResolvedValue([]);
		mocks.listSeatStates.mockResolvedValue([]);
		mocks.syncOrganizationSeatState.mockResolvedValue({ changed: true });
		mocks.cancelPlaceholder.mockResolvedValue(undefined);
		mocks.subscriptionProjection.mockResolvedValue({
			billingPlan: 'cloud_team_monthly_v1',
			billingStatus: 'active',
			stripeCustomerId: 'cus_cloud',
			stripeSubscriptionId: 'sub_active',
			stripeSubscriptionItemId: 'si_team',
			seatQuantity: 8,
			stripeSubscriptionScheduleId: 'sub_sched_team',
			pendingBillingPlan: 'cloud_team_yearly_v1',
			pendingSeatQuantity: 7,
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
		).resolves.toMatchObject({
			applied: true,
			ignored: false,
			before: { stripeSubscriptionId: 'sub_old' },
			after: {
				stripeSubscriptionId: 'sub_active',
				stripeSubscriptionItemId: 'si_team',
				seatQuantity: 8,
				stripeSubscriptionScheduleId: 'sub_sched_team',
				pendingBillingPlan: 'cloud_team_yearly_v1',
				pendingSeatQuantity: 7,
			},
		});

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

	it('preserves the local trial start and accepts the live subscription trial end', async () => {
		const stripeTrialStartedAt = new Date('2026-02-01T00:00:00.000Z');
		const trialEndsAt = new Date('2026-02-15T00:00:00.000Z');
		mocks.listSubscriptions.mockResolvedValue([buildSubscription()]);
		mocks.subscriptionProjection.mockResolvedValue({
			billingStatus: 'trialing',
			stripeCustomerId: 'cus_cloud',
			stripeSubscriptionId: 'sub_active',
			trialStartedAt: stripeTrialStartedAt,
			trialEndsAt,
		});

		await reconcileCloudBillingCustomer({ stripeCustomerId: 'cus_cloud' });

		expect(mocks.updateSubscription).toHaveBeenCalledWith(
			'org-id',
			'sync-token',
			expect.objectContaining({
				trialStartedAt: new Date('2026-01-01T00:00:00.000Z'),
				trialEndsAt,
			}),
		);
	});

	it('carries a later placeholder extension into the paid trial before cleanup', async () => {
		const paid = buildSubscription({ id: 'sub_paid', status: 'trialing', trial_end: 1_800_000_000 });
		const placeholder = buildSubscription({
			id: 'sub_placeholder',
			metadata: { nao_org_id: 'org-id', nao_subscription_kind: 'trial-placeholder' },
			status: 'trialing',
			trial_end: 1_800_086_400,
		});
		const updatedPaid = { ...paid, trial_end: placeholder.trial_end };
		mocks.listSubscriptions.mockResolvedValue([placeholder, paid]);
		mocks.updatePaidTrialEnd.mockResolvedValue(updatedPaid);

		await reconcileCloudBillingCustomer({ stripeCustomerId: 'cus_cloud' });

		expect(mocks.updatePaidTrialEnd).toHaveBeenCalledWith(paid, 'org-id', new Date(1_800_086_400 * 1000));
		expect(mocks.subscriptionProjection).toHaveBeenCalledWith(updatedPaid);
		expect(mocks.cancelPlaceholder).toHaveBeenCalledWith(placeholder, 'org-id');
	});

	it('keeps terminal paid history authoritative over a current placeholder', async () => {
		const paid = buildSubscription({ id: 'sub_paid', status: 'canceled', created: 10 });
		const placeholder = buildSubscription({
			id: 'sub_placeholder',
			metadata: { nao_org_id: 'org-id', nao_subscription_kind: 'trial-placeholder' },
			status: 'trialing',
			created: 20,
		});
		mocks.listSubscriptions.mockResolvedValue([placeholder, paid]);

		await reconcileCloudBillingCustomer({ stripeCustomerId: 'cus_cloud' });

		expect(mocks.subscriptionProjection).toHaveBeenCalledWith(paid);
		expect(mocks.cancelPlaceholder).toHaveBeenCalledWith(placeholder, 'org-id');
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

		await expect(reconcileCloudBillingCustomer({ stripeCustomerId: 'cus_cloud' })).resolves.toMatchObject({
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

		await expect(reconcileCloudBillingCustomer({ stripeCustomerId: 'cus_cloud' })).resolves.toMatchObject({
			applied: true,
			ignored: false,
			before: { stripeSubscriptionId: 'sub_old' },
			after: null,
		});

		expect(mocks.updatePaymentMethod).toHaveBeenCalledWith('org-id', 'sync-token', 'cus_cloud', true);
	});

	it('ignores an unrelated Stripe Customer without an organization or cloud subscription', async () => {
		mocks.getBillingByCustomer.mockResolvedValue(null);
		mocks.listSubscriptions.mockResolvedValue([]);

		await expect(reconcileCloudBillingCustomer({ stripeCustomerId: 'cus_unrelated' })).resolves.toEqual({
			applied: false,
			ignored: true,
			before: null,
			after: null,
			newlyReadOnlyUserIds: [],
		});
		expect(mocks.claimSync).not.toHaveBeenCalled();
	});

	it('yields to a concurrent reconciliation that superseded its sync token', async () => {
		mocks.listSubscriptions.mockResolvedValue([buildSubscription()]);
		mocks.updateSubscription.mockResolvedValue(false);

		await expect(reconcileCloudBillingCustomer({ stripeCustomerId: 'cus_cloud' })).resolves.toMatchObject({
			applied: false,
			ignored: false,
			after: null,
		});
	});

	it('syncs a capacity contraction and returns newly read-only user ids', async () => {
		const billing = buildBilling({
			billingPlan: 'cloud_unlimited_monthly_v1',
			billingStatus: 'active',
			currentPeriodEndsAt: new Date('2999-01-01T00:00:00.000Z'),
		});
		mocks.getBillingByCustomer.mockResolvedValue(billing);
		mocks.claimSync.mockResolvedValue({ billing, token: 'sync-token' });
		mocks.isCloudFreeTierEnabled.mockReturnValue(true);
		mocks.getOrganizationById.mockResolvedValue({ id: 'org-id', bypassBilling: false });
		mocks.countOrgSeatUsers.mockResolvedValue(4);
		mocks.listSubscriptions.mockResolvedValue([buildSubscription()]);
		mocks.subscriptionProjection.mockResolvedValue({
			...subscriptionProjection(),
			billingPlan: 'cloud_team_monthly_v1',
			seatQuantity: 2,
		});
		mocks.listReadOnlyOrgUsers.mockResolvedValue([{ id: 'user-3' }, { id: 'user-4' }]);

		await expect(reconcileCloudBillingCustomer({ stripeCustomerId: 'cus_cloud' })).resolves.toMatchObject({
			newlyReadOnlyUserIds: ['user-3', 'user-4'],
		});
		expect(mocks.syncOrganizationSeatState).toHaveBeenCalledTimes(2);
		expect(mocks.syncOrganizationSeatState).toHaveBeenCalledWith(
			expect.objectContaining({ orgId: 'org-id', userId: 'user-3', isReadOnly: true }),
		);
	});

	it('syncs read-only users back to seated when capacity expands', async () => {
		const billing = buildBilling({
			billingPlan: 'cloud_team_monthly_v1',
			billingStatus: 'active',
			seatQuantity: 2,
			currentPeriodEndsAt: new Date('2999-01-01T00:00:00.000Z'),
		});
		mocks.getBillingByCustomer.mockResolvedValue(billing);
		mocks.claimSync.mockResolvedValue({ billing, token: 'sync-token' });
		mocks.isCloudFreeTierEnabled.mockReturnValue(true);
		mocks.getOrganizationById.mockResolvedValue({ id: 'org-id', bypassBilling: false });
		mocks.countOrgSeatUsers.mockResolvedValue(4);
		mocks.listSubscriptions.mockResolvedValue([buildSubscription()]);
		mocks.subscriptionProjection.mockResolvedValue({
			...subscriptionProjection(),
			billingPlan: 'cloud_team_monthly_v1',
			seatQuantity: 4,
		});
		mocks.listReadOnlyOrgUsers.mockImplementation(async (_organizationId: string, seatLimit: number) =>
			seatLimit === 2 ? [{ id: 'user-3' }, { id: 'user-4' }] : [],
		);

		await expect(reconcileCloudBillingCustomer({ stripeCustomerId: 'cus_cloud' })).resolves.toMatchObject({
			newlyReadOnlyUserIds: [],
		});
		expect(mocks.syncOrganizationSeatState).toHaveBeenCalledTimes(2);
		expect(mocks.syncOrganizationSeatState).toHaveBeenCalledWith(
			expect.objectContaining({ orgId: 'org-id', userId: 'user-3', isReadOnly: false }),
		);
	});
});

function buildBilling(overrides: Record<string, unknown> = {}) {
	return {
		orgId: 'org-id',
		stripeCustomerId: 'cus_cloud',
		stripeSubscriptionId: 'sub_old',
		stripeSubscriptionItemId: 'si_old',
		seatQuantity: 4,
		stripeSubscriptionScheduleId: null,
		pendingBillingPlan: null,
		pendingSeatQuantity: null,
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

function subscriptionProjection() {
	return {
		billingStatus: 'active',
		stripeCustomerId: 'cus_cloud',
		stripeSubscriptionId: 'sub_active',
		stripeSubscriptionItemId: 'si_team',
		stripePriceId: 'price_team',
		stripeSubscriptionScheduleId: null,
		pendingBillingPlan: null,
		pendingSeatQuantity: null,
		trialStartedAt: null,
		trialEndsAt: null,
		currentPeriodStartsAt: new Date('2026-01-01T00:00:00.000Z'),
		currentPeriodEndsAt: new Date('2999-01-01T00:00:00.000Z'),
		cancellationScheduled: false,
		hasDefaultPaymentMethod: true,
		billingAccessEndsAt: null,
	};
}
