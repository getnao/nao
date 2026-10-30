import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	attachSchedule: vi.fn(),
	clearPending: vi.fn(),
	getBilling: vi.fn(),
	getSchedule: vi.fn(),
	getSubscription: vi.fn(),
	listMappedOrganizations: vi.fn(),
	listPendingTrials: vi.fn(),
	logError: vi.fn(),
	projectSubscription: vi.fn(),
	provisionTrial: vi.fn(),
	reconcileCustomer: vi.fn(),
	releaseSchedule: vi.fn(),
	updateSchedule: vi.fn(),
}));

vi.mock('../src/env', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/env')>()),
	isCloudFreeTierEnabled: () => true,
}));

vi.mock('../src/queries/billing.queries', () => ({
	attachSubscriptionSchedule: mocks.attachSchedule,
	clearPendingBillingChange: mocks.clearPending,
	getOrganizationBilling: mocks.getBilling,
	listOrganizationBillingsWithStripeCustomers: mocks.listMappedOrganizations,
	listOrganizationTrialsPendingStripeProvisioning: mocks.listPendingTrials,
}));

vi.mock('../src/services/billing-reconciliation.service', () => ({
	reconcileCloudBillingCustomerUnderLock: mocks.reconcileCustomer,
}));

vi.mock('../src/services/stripe.service', () => ({
	cloudSubscriptionProjection: mocks.projectSubscription,
	getCloudPlanChangeSchedule: mocks.getSchedule,
	getCloudSubscription: mocks.getSubscription,
	releaseCloudPlanChangeSchedule: mocks.releaseSchedule,
	updateCloudPlanChangeSchedule: mocks.updateSchedule,
}));

vi.mock('../src/services/cloud-trial-provisioning.service', () => ({
	provisionCloudTrial: mocks.provisionTrial,
}));

vi.mock('../src/utils/logger', () => ({
	logger: { error: mocks.logError },
	serializeError: (error: unknown) => ({ error: String(error) }),
}));

import { runCloudBillingLifecycle } from '../src/services/billing-lifecycle.service';

describe('cloud billing lifecycle', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.listPendingTrials.mockResolvedValue([]);
		mocks.provisionTrial.mockResolvedValue(undefined);
		mocks.getBilling.mockImplementation(async (organizationId: string) => ({
			orgId: organizationId,
			stripeCustomerId: `cus_${organizationId.replace('org-', '')}`,
			stripeSubscriptionId: null,
		}));
	});

	it('continues provisioning and reconciles a mapped organization after its provisioning fails', async () => {
		mocks.listPendingTrials.mockResolvedValue([{ orgId: 'org-one' }, { orgId: 'org-two' }]);
		mocks.listMappedOrganizations.mockResolvedValue([
			{ orgId: 'org-one', stripeCustomerId: 'cus_one' },
			{ orgId: 'org-two', stripeCustomerId: 'cus_two' },
			{ orgId: 'org-three', stripeCustomerId: 'cus_three' },
		]);
		mocks.provisionTrial.mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce(undefined);
		mocks.reconcileCustomer.mockResolvedValue({ applied: true, ignored: false });

		await expect(runCloudBillingLifecycle()).resolves.toBeUndefined();

		expect(mocks.provisionTrial).toHaveBeenCalledTimes(2);
		expect(mocks.provisionTrial).toHaveBeenNthCalledWith(1, 'org-one');
		expect(mocks.provisionTrial).toHaveBeenNthCalledWith(2, 'org-two');
		expect(mocks.reconcileCustomer).toHaveBeenCalledTimes(2);
		expect(mocks.reconcileCustomer).toHaveBeenNthCalledWith(1, {
			stripeCustomerId: 'cus_one',
			organizationIdHint: 'org-one',
		});
		expect(mocks.reconcileCustomer).toHaveBeenNthCalledWith(2, {
			stripeCustomerId: 'cus_three',
			organizationIdHint: 'org-three',
		});
		expect(mocks.reconcileCustomer).not.toHaveBeenCalledWith({
			stripeCustomerId: 'cus_two',
			organizationIdHint: 'org-two',
		});
		expect(mocks.logError).toHaveBeenCalledWith(
			'Cloud trial provisioning recovery failed for organization org-one',
			{
				source: 'system',
				context: { error: 'Error: temporary' },
			},
		);
	});

	it('reconciles every mapped organization without aborting after one failure', async () => {
		mocks.listMappedOrganizations.mockResolvedValue([
			{ orgId: 'org-one', stripeCustomerId: 'cus_one' },
			{ orgId: 'org-two', stripeCustomerId: 'cus_two' },
		]);
		mocks.reconcileCustomer.mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce({
			applied: true,
			ignored: false,
		});

		await expect(runCloudBillingLifecycle()).resolves.toBeUndefined();

		expect(mocks.reconcileCustomer).toHaveBeenCalledTimes(2);
		expect(mocks.logError).toHaveBeenCalledOnce();
		expect(mocks.logError).toHaveBeenCalledWith('Cloud billing reconciliation failed for organization org-one', {
			source: 'system',
			context: { error: 'Error: temporary' },
		});
	});

	it('limits concurrent Stripe reconciliation', async () => {
		let active = 0;
		let maxActive = 0;
		mocks.listMappedOrganizations.mockResolvedValue(
			Array.from({ length: 12 }, (_, index) => ({
				orgId: `org-${index}`,
				stripeCustomerId: `cus_${index}`,
			})),
		);
		mocks.reconcileCustomer.mockImplementation(async () => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			await Promise.resolve();
			active -= 1;
			return { applied: true, ignored: false };
		});

		await runCloudBillingLifecycle();

		expect(mocks.reconcileCustomer).toHaveBeenCalledTimes(12);
		expect(maxActive).toBe(5);
	});

	it('releases an orphaned attached schedule with no persisted intent', async () => {
		mocks.listMappedOrganizations.mockResolvedValue([{ orgId: 'org-one', stripeCustomerId: 'cus_one' }]);
		mocks.getBilling.mockResolvedValue({
			orgId: 'org-one',
			stripeCustomerId: 'cus_one',
			stripeSubscriptionId: 'sub_one',
			stripeSubscriptionScheduleId: null,
			pendingBillingPlan: null,
			pendingSeatQuantity: null,
		});
		mocks.getSubscription.mockResolvedValue({ id: 'sub_one', schedule: 'sched_one' });
		mocks.projectSubscription.mockResolvedValue({
			stripeSubscriptionScheduleId: 'sched_one',
			billingPlan: 'cloud_team_monthly',
			pendingBillingPlan: null,
			pendingSeatQuantity: null,
		});
		mocks.reconcileCustomer.mockResolvedValue({ applied: true, ignored: false });

		await runCloudBillingLifecycle();

		expect(mocks.releaseSchedule).toHaveBeenCalledWith('sched_one');
		expect(mocks.clearPending).toHaveBeenCalledWith('org-one');
	});

	it('completes an attached schedule from matching persisted intent after a crash', async () => {
		const currentPeriodEndsAt = new Date('2027-01-01T00:00:00.000Z');
		mocks.listMappedOrganizations.mockResolvedValue([{ orgId: 'org-one', stripeCustomerId: 'cus_one' }]);
		mocks.getBilling.mockResolvedValue({
			orgId: 'org-one',
			stripeCustomerId: 'cus_one',
			stripeSubscriptionId: 'sub_one',
			stripeSubscriptionScheduleId: null,
			pendingBillingPlan: 'cloud_team_yearly_v1',
			pendingSeatQuantity: 5,
			currentPeriodEndsAt,
		});
		mocks.getSubscription.mockResolvedValue({ id: 'sub_one', schedule: 'sched_one' });
		mocks.projectSubscription.mockResolvedValue({
			stripeSubscriptionScheduleId: 'sched_one',
			billingPlan: 'cloud_team_monthly',
			pendingBillingPlan: null,
			pendingSeatQuantity: null,
		});
		mocks.getSchedule.mockResolvedValue({ id: 'sched_one' });
		mocks.reconcileCustomer.mockResolvedValue({ applied: true, ignored: false });

		await runCloudBillingLifecycle();

		expect(mocks.updateSchedule).toHaveBeenCalledWith({
			schedule: { id: 'sched_one' },
			targetPlanKey: 'cloud_team_yearly_v1',
			targetQuantity: 5,
			effectiveAt: currentPeriodEndsAt,
		});
		expect(mocks.attachSchedule).toHaveBeenCalledWith('org-one', 'sched_one');
		expect(mocks.releaseSchedule).not.toHaveBeenCalled();
	});

	it('releases an activated schedule that Stripe still reports as attached', async () => {
		mocks.listMappedOrganizations.mockResolvedValue([{ orgId: 'org-one', stripeCustomerId: 'cus_one' }]);
		mocks.getBilling.mockResolvedValue({
			orgId: 'org-one',
			stripeCustomerId: 'cus_one',
			stripeSubscriptionId: 'sub_one',
			stripeSubscriptionScheduleId: 'sched_one',
			pendingBillingPlan: 'cloud_unlimited_yearly_v1',
			pendingSeatQuantity: null,
		});
		mocks.getSubscription.mockResolvedValue({ id: 'sub_one', schedule: 'sched_one' });
		mocks.projectSubscription.mockResolvedValue({
			stripeSubscriptionScheduleId: 'sched_one',
			billingPlan: 'cloud_unlimited_yearly_v1',
			pendingBillingPlan: null,
			pendingSeatQuantity: null,
		});
		mocks.reconcileCustomer.mockResolvedValue({ applied: true, ignored: false });

		await runCloudBillingLifecycle();

		expect(mocks.releaseSchedule).toHaveBeenCalledWith('sched_one');
		expect(mocks.clearPending).toHaveBeenCalledWith('org-one');
	});
});
