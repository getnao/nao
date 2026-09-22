import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	attachCustomer: vi.fn(),
	getCheckoutSubscription: vi.fn(),
	getEvent: vi.fn(),
	getInboxEvent: vi.fn(),
	getOrganizationByCustomer: vi.fn(),
	getOrganizationById: vi.fn(),
	getOrganizationBySubscription: vi.fn(),
	getSubscription: vi.fn(),
	markFailed: vi.fn(),
	markProcessed: vi.fn(),
	projectSubscription: vi.fn(),
	updateProjection: vi.fn(),
}));

vi.mock('../src/queries/billing.queries', () => ({
	attachStripeCustomer: mocks.attachCustomer,
	getOrganizationByStripeCustomerId: mocks.getOrganizationByCustomer,
	getOrganizationByStripeSubscriptionId: mocks.getOrganizationBySubscription,
	getStripeWebhookEvent: mocks.getInboxEvent,
	markStripeWebhookEventFailed: mocks.markFailed,
	markStripeWebhookEventProcessed: mocks.markProcessed,
	updateSubscriptionProjection: mocks.updateProjection,
}));

vi.mock('../src/queries/organization.queries', () => ({
	getOrganizationById: mocks.getOrganizationById,
}));

vi.mock('../src/services/stripe.service', () => ({
	cloudSubscriptionProjection: mocks.projectSubscription,
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
		mocks.getOrganizationBySubscription.mockResolvedValue(null);
		mocks.getOrganizationByCustomer.mockResolvedValue({
			id: 'org-id',
			stripeCustomerId: 'cus_cloud',
		});
		mocks.projectSubscription.mockResolvedValue({ billingStatus: 'trialing' });
	});

	it('does not process an inbox event twice', async () => {
		mocks.getInboxEvent.mockResolvedValue({ id: 'evt_123', processedAt: new Date() });

		await stripeWebhookHandler({ eventId: 'evt_123' }, {} as never);

		expect(mocks.getEvent).not.toHaveBeenCalled();
		expect(mocks.updateProjection).not.toHaveBeenCalled();
	});

	it('persists the trial only after Checkout completion is confirmed', async () => {
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
		mocks.projectSubscription.mockResolvedValue({
			billingStatus: 'trialing',
			trialEndsAt: new Date('2026-10-06T00:00:00.000Z'),
		});

		await stripeWebhookHandler({ eventId: 'evt_123' }, {} as never);

		expect(mocks.updateProjection).toHaveBeenCalledWith(
			'org-id',
			expect.objectContaining({ billingStatus: 'trialing' }),
		);
		expect(mocks.markProcessed).toHaveBeenCalledWith('evt_123');
	});

	it('projects freshly retrieved subscription state instead of an out-of-order event snapshot', async () => {
		const currentSubscription = {
			id: 'sub_cloud',
			customer: 'cus_cloud',
			metadata: { nao_org_id: 'org-id' },
			status: 'paused',
		};
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
		mocks.getSubscription.mockResolvedValue(currentSubscription);
		mocks.projectSubscription.mockResolvedValue({ billingStatus: 'paused' });

		await stripeWebhookHandler({ eventId: 'evt_123' }, {} as never);

		expect(mocks.projectSubscription).toHaveBeenCalledWith(currentSubscription);
		expect(mocks.updateProjection).toHaveBeenCalledWith('org-id', { billingStatus: 'paused' });
		expect(mocks.markProcessed).toHaveBeenCalledWith('evt_123');
	});
});
