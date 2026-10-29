import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	attachCustomer: vi.fn(),
	createCustomer: vi.fn(),
	createPlaceholder: vi.fn(),
	getAdmin: vi.fn(),
	getOrganization: vi.fn(),
	getUserProfile: vi.fn(),
	getUserRole: vi.fn(),
	listSubscriptions: vi.fn(),
	reconcileCustomer: vi.fn(),
}));

vi.mock('../src/queries/billing.queries', () => ({
	attachStripeCustomer: mocks.attachCustomer,
	getOrganizationWithBilling: mocks.getOrganization,
}));

vi.mock('../src/queries/organization.queries', () => ({
	getEarliestOrganizationAdmin: mocks.getAdmin,
	getUserRoleInOrg: mocks.getUserRole,
}));

vi.mock('../src/queries/user.queries', () => ({
	getUserProfile: mocks.getUserProfile,
}));

vi.mock('../src/services/billing-reconciliation.service', () => ({
	reconcileCloudBillingCustomer: mocks.reconcileCustomer,
}));

vi.mock('../src/services/stripe.service', () => ({
	createCloudCustomer: mocks.createCustomer,
	createCloudTrialPlaceholderSubscription: mocks.createPlaceholder,
	listCloudSubscriptions: mocks.listSubscriptions,
}));

import { provisionCloudTrial } from '../src/services/cloud-trial-provisioning.service';

const trialEnd = new Date('2099-01-15T00:00:00.000Z');

describe('cloud trial provisioning', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getOrganization.mockResolvedValue(organization());
		mocks.getAdmin.mockResolvedValue({ id: 'user-admin', email: 'admin@example.com', name: 'Admin' });
		mocks.getUserProfile.mockResolvedValue({
			id: 'user-acting-admin',
			email: 'acting-admin@example.com',
			name: 'Acting Admin',
		});
		mocks.getUserRole.mockResolvedValue('member');
		mocks.createCustomer.mockResolvedValue({ id: 'cus_cloud' });
		mocks.attachCustomer.mockResolvedValue({ stripeCustomerId: 'cus_cloud' });
		mocks.listSubscriptions.mockResolvedValue([]);
		mocks.createPlaceholder.mockResolvedValue({ id: 'sub_trial' });
		mocks.reconcileCustomer.mockResolvedValue({ applied: true, ignored: false });
	});

	it('creates and attaches the Customer before creating the placeholder trial', async () => {
		await provisionCloudTrial('org-id', 'user-member');

		expect(mocks.createCustomer).toHaveBeenCalledWith({
			organizationId: 'org-id',
			organizationName: 'Acme',
			adminEmail: 'admin@example.com',
		});
		expect(mocks.attachCustomer).toHaveBeenCalledWith('org-id', 'cus_cloud');
		expect(mocks.createPlaceholder).toHaveBeenCalledWith({
			organizationId: 'org-id',
			stripeCustomerId: 'cus_cloud',
			trialEnd,
		});
		expect(mocks.createCustomer.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.attachCustomer.mock.invocationCallOrder[0],
		);
		expect(mocks.attachCustomer.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.createPlaceholder.mock.invocationCallOrder[0],
		);
		expect(mocks.reconcileCustomer).toHaveBeenCalledWith({
			stripeCustomerId: 'cus_cloud',
			organizationIdHint: 'org-id',
		});
	});

	it('uses the acting admin email for Stripe Customer creation', async () => {
		mocks.getUserRole.mockResolvedValue('admin');

		await provisionCloudTrial('org-id', 'user-acting-admin');

		expect(mocks.getUserRole).toHaveBeenCalledWith('org-id', 'user-acting-admin');
		expect(mocks.createCustomer).toHaveBeenCalledWith({
			organizationId: 'org-id',
			organizationName: 'Acme',
			adminEmail: 'acting-admin@example.com',
		});
		expect(mocks.getAdmin).not.toHaveBeenCalled();
	});

	it('reuses an existing Customer and placeholder Subscription', async () => {
		mocks.getOrganization.mockResolvedValue(
			organization({ billing: { ...organization().billing, stripeCustomerId: 'cus_existing' } }),
		);
		mocks.listSubscriptions.mockResolvedValue([{ id: 'sub_existing' }]);

		await provisionCloudTrial('org-id');

		expect(mocks.getAdmin).not.toHaveBeenCalled();
		expect(mocks.createCustomer).not.toHaveBeenCalled();
		expect(mocks.createPlaceholder).not.toHaveBeenCalled();
		expect(mocks.reconcileCustomer).toHaveBeenCalledWith({
			stripeCustomerId: 'cus_existing',
			organizationIdHint: 'org-id',
		});
	});

	it('does not provision a fresh Stripe trial after the local trial expires', async () => {
		mocks.getOrganization.mockResolvedValue(
			organization({ billing: { ...organization().billing, trialEndsAt: new Date(0) } }),
		);

		await provisionCloudTrial('org-id');

		expect(mocks.getAdmin).not.toHaveBeenCalled();
		expect(mocks.createCustomer).not.toHaveBeenCalled();
		expect(mocks.createPlaceholder).not.toHaveBeenCalled();
		expect(mocks.reconcileCustomer).not.toHaveBeenCalled();
	});
});

function organization(overrides: Record<string, unknown> = {}) {
	return {
		id: 'org-id',
		name: 'Acme',
		bypassBilling: false,
		billing: {
			billingStatus: 'trialing',
			stripeCustomerId: null,
			trialEndsAt: trialEnd,
		},
		...overrides,
	};
}
