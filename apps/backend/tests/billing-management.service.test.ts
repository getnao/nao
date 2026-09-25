import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getMember: vi.fn(),
	getOrganization: vi.fn(),
	attachCustomer: vi.fn(),
	reconcileCustomer: vi.fn(),
	createCheckout: vi.fn(),
	createCustomer: vi.fn(),
	createPaymentMethod: vi.fn(),
	createPortal: vi.fn(),
	createResubscribe: vi.fn(),
	listInvoices: vi.fn(),
	resumeSubscription: vi.fn(),
}));

vi.mock('../src/queries/organization.queries', () => ({
	getOrgMember: mocks.getMember,
	getOrganizationById: mocks.getOrganization,
}));

vi.mock('../src/queries/user.queries', () => ({
	getUser: vi.fn(),
}));

vi.mock('../src/queries/billing.queries', () => ({
	attachStripeCustomer: mocks.attachCustomer,
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
	listCloudInvoices: mocks.listInvoices,
	resumeCloudSubscription: mocks.resumeSubscription,
}));

import {
	createCloudCheckoutForAdmin,
	createCloudPaymentMethodPortalForAdmin,
	createCloudPortalForAdmin,
	createCloudResubscribeForAdmin,
	getCloudBillingOrganizationForAdmin,
	listCloudInvoicesForAdmin,
	resumeCloudSubscriptionForAdmin,
	startCloudTrialForAdmin,
	syncCloudBillingForAdmin,
} from '../src/services/billing-management.service';

const adminInput = { userId: 'user-id', organizationId: 'org-id' };
const requestInput = { ...adminInput, requestId: 'request-id' };

describe('billing management authorization', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getMember.mockResolvedValue({ role: 'member' });
	});

	it.each([
		['billing status', () => getCloudBillingOrganizationForAdmin(adminInput)],
		['invoices', () => listCloudInvoicesForAdmin(adminInput)],
		['billing synchronization', () => syncCloudBillingForAdmin(adminInput)],
		['trial Checkout', () => startCloudTrialForAdmin(adminInput)],
		['Checkout', () => createCloudCheckoutForAdmin(adminInput)],
		['Customer Portal', () => createCloudPortalForAdmin(requestInput)],
		['payment methods', () => createCloudPaymentMethodPortalForAdmin(requestInput)],
		['resubscription', () => createCloudResubscribeForAdmin(adminInput)],
		['subscription resume', () => resumeCloudSubscriptionForAdmin(requestInput)],
	])('rejects a non-admin before %s work', async (_name, operation) => {
		await expect(operation()).rejects.toMatchObject({ codeMessage: 'FORBIDDEN' });
		expect(mocks.getOrganization).not.toHaveBeenCalled();
		expect([
			mocks.attachCustomer,
			mocks.reconcileCustomer,
			mocks.createCheckout,
			mocks.createCustomer,
			mocks.createPaymentMethod,
			mocks.createPortal,
			mocks.createResubscribe,
			mocks.listInvoices,
			mocks.resumeSubscription,
		]).toSatisfy((stripeCalls) => stripeCalls.every((mock) => mock.mock.calls.length === 0));
	});
});
