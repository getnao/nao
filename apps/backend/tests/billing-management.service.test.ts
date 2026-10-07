import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getOrganizationWithBilling: vi.fn(),
	attachCustomer: vi.fn(),
	reconcileCustomer: vi.fn(),
	createCheckout: vi.fn(),
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

vi.mock('../src/services/stripe.service', () => ({
	CloudInitialCheckoutUnavailableError: class extends Error {},
	createCloudCheckoutSession: mocks.createCheckout,
	createCloudCustomer: mocks.createCustomer,
	createCloudPaymentMethodSession: mocks.createPaymentMethod,
	createCloudPortalSession: mocks.createPortal,
	createCloudResubscribeSession: mocks.createResubscribe,
	getCloudUpcomingInvoice: mocks.getUpcomingInvoice,
	listCloudInvoices: mocks.listInvoices,
	resumeCloudSubscription: mocks.resumeSubscription,
}));

import { getCloudBillingOrganizationForAdmin } from '../src/services/billing-management.service';

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
});
