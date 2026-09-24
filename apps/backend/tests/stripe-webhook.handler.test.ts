import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getCheckoutSubscription: vi.fn(),
	getEvent: vi.fn(),
	getInboxEvent: vi.fn(),
	getOrganizationByCustomer: vi.fn(),
	getSubscription: vi.fn(),
	markFailed: vi.fn(),
	markProcessed: vi.fn(),
	reconcileCustomer: vi.fn(),
	sendTrialReminder: vi.fn(),
}));

vi.mock('../src/queries/billing.queries', () => ({
	getOrganizationByStripeCustomerId: mocks.getOrganizationByCustomer,
	getStripeWebhookEvent: mocks.getInboxEvent,
	markStripeWebhookEventFailed: mocks.markFailed,
	markStripeWebhookEventProcessed: mocks.markProcessed,
}));

vi.mock('../src/services/billing-reconciliation.service', () => ({
	reconcileCloudBillingCustomer: mocks.reconcileCustomer,
}));

vi.mock('../src/services/billing-lifecycle.service', () => ({
	sendCloudTrialReminder: mocks.sendTrialReminder,
}));

vi.mock('../src/services/stripe.service', () => ({
	getCloudCheckoutSubscription: mocks.getCheckoutSubscription,
	getCloudSubscription: mocks.getSubscription,
	getStripeEvent: mocks.getEvent,
}));

import { stripeWebhookHandler } from '../src/handlers/stripe-webhook.handler';

describe('stripeWebhookHandler', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getInboxEvent.mockResolvedValue({
			id: 'evt_123',
			processedAt: null,
		});
		mocks.reconcileCustomer.mockResolvedValue({
			applied: true,
			ignored: false,
		});
	});

	it('does not process an inbox event twice', async () => {
		mocks.getInboxEvent.mockResolvedValue({ id: 'evt_123', processedAt: new Date() });

		await stripeWebhookHandler({ eventId: 'evt_123' }, {} as never);

		expect(mocks.getEvent).not.toHaveBeenCalled();
		expect(mocks.reconcileCustomer).not.toHaveBeenCalled();
	});

	it('reconciles subscription state after Checkout completion', async () => {
		const subscription = {
			id: 'sub_cloud',
			customer: 'cus_cloud',
			metadata: { nao_org_id: 'org-id' },
			status: 'trialing',
		};
		mocks.getEvent.mockResolvedValue({
			type: 'checkout.session.completed',
			data: { object: { id: 'cs_cloud' } },
		});
		mocks.getCheckoutSubscription.mockResolvedValue({
			session: {
				id: 'cs_cloud',
				client_reference_id: 'org-id',
				customer: 'cus_cloud',
				metadata: { nao_org_id: 'org-id' },
			},
			subscription,
		});
		await stripeWebhookHandler({ eventId: 'evt_123' }, {} as never);

		expect(mocks.reconcileCustomer).toHaveBeenCalledWith({
			stripeCustomerId: 'cus_cloud',
			organizationIdHint: 'org-id',
		});
		expect(mocks.markProcessed).toHaveBeenCalledWith('evt_123');
	});

	it('reconciles subscription events by Customer', async () => {
		mocks.getEvent.mockResolvedValue({
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: 'sub_cloud',
					customer: 'cus_cloud',
					metadata: { nao_org_id: 'org-id' },
					status: 'trialing',
				},
			},
		});

		await stripeWebhookHandler({ eventId: 'evt_123' }, {} as never);

		expect(mocks.reconcileCustomer).toHaveBeenCalledWith({
			stripeCustomerId: 'cus_cloud',
			organizationIdHint: 'org-id',
		});
		expect(mocks.markProcessed).toHaveBeenCalledWith('evt_123');
	});

	it('notifies the mapped organization when a trial will end', async () => {
		mocks.getEvent.mockResolvedValue({
			type: 'customer.subscription.trial_will_end',
			data: {
				object: {
					customer: 'cus_cloud',
					metadata: { nao_org_id: 'org-id' },
				},
			},
		});
		mocks.getOrganizationByCustomer.mockResolvedValue({ id: 'org-id' });

		await stripeWebhookHandler({ eventId: 'evt_123' }, {} as never);

		expect(mocks.sendTrialReminder).toHaveBeenCalledWith('org-id');
	});

	it('projects the latest Customer payment-method state', async () => {
		mocks.getEvent.mockResolvedValue({
			type: 'customer.updated',
			data: { object: { id: 'cus_cloud' } },
		});
		await stripeWebhookHandler({ eventId: 'evt_123' }, {} as never);

		expect(mocks.reconcileCustomer).toHaveBeenCalledWith({ stripeCustomerId: 'cus_cloud' });
		expect(mocks.markProcessed).toHaveBeenCalledWith('evt_123');
	});
});
