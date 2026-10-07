import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	listMappedOrganizations: vi.fn(),
	logError: vi.fn(),
	reconcileCustomer: vi.fn(),
}));

vi.mock('../src/queries/billing.queries', () => ({
	listOrganizationBillingsWithStripeCustomers: mocks.listMappedOrganizations,
}));

vi.mock('../src/services/billing-reconciliation.service', () => ({
	reconcileCloudBillingCustomer: mocks.reconcileCustomer,
}));

vi.mock('../src/utils/logger', () => ({
	logger: { error: mocks.logError },
	serializeError: (error: unknown) => ({ error: String(error) }),
}));

import { runCloudBillingLifecycle } from '../src/services/billing-lifecycle.service';

describe('cloud billing lifecycle', () => {
	beforeEach(() => {
		vi.clearAllMocks();
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
});
