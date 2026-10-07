import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	findSubscription: vi.fn(),
	getCheckoutSession: vi.fn(),
	getCheckoutSubscription: vi.fn(),
	getEvent: vi.fn(),
	getInboxEvent: vi.fn(),
	getInvoice: vi.fn(),
	getPaymentMethod: vi.fn(),
	listMappedOrganizations: vi.fn(),
	markFailed: vi.fn(),
	markProcessed: vi.fn(),
	reconcileCustomer: vi.fn(),
}));

vi.mock('../src/queries/billing.queries', () => ({
	getStripeWebhookEvent: mocks.getInboxEvent,
	listOrganizationBillingsWithStripeCustomers: mocks.listMappedOrganizations,
	markStripeWebhookEventFailed: mocks.markFailed,
	markStripeWebhookEventProcessed: mocks.markProcessed,
}));

vi.mock('../src/services/billing-reconciliation.service', () => ({
	reconcileCloudBillingCustomer: mocks.reconcileCustomer,
}));

vi.mock('../src/services/stripe.service', () => ({
	findCloudSubscription: mocks.findSubscription,
	getCloudCheckoutSubscription: mocks.getCheckoutSubscription,
	getStripeCheckoutSession: mocks.getCheckoutSession,
	getStripeEvent: mocks.getEvent,
	getStripeInvoice: mocks.getInvoice,
	getStripePaymentMethod: mocks.getPaymentMethod,
}));

import { stripeWebhookProcessHandler } from '../src/handlers/stripe-webhook.handler';

const CHECKOUT_EVENT_TYPES = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'] as const;

describe('stripeWebhookProcessHandler', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getInboxEvent.mockResolvedValue({
			id: 'evt_123',
			processedAt: null,
		});
		mocks.listMappedOrganizations.mockResolvedValue([]);
		mocks.reconcileCustomer.mockResolvedValue({
			applied: true,
			ignored: false,
		});
	});

	it('rejects a job whose inbox event is missing', async () => {
		mocks.getInboxEvent.mockResolvedValue(null);

		await expect(stripeWebhookProcessHandler({ eventId: 'evt_missing' }, {} as never)).rejects.toThrow(
			'Stripe webhook event "evt_missing" was not found',
		);

		expect(mocks.getEvent).not.toHaveBeenCalled();
		expect(mocks.markFailed).not.toHaveBeenCalled();
		expect(mocks.markProcessed).not.toHaveBeenCalled();
	});

	it('does not process an inbox event twice', async () => {
		mocks.getInboxEvent.mockResolvedValue({ id: 'evt_123', processedAt: new Date() });

		await stripeWebhookProcessHandler({ eventId: 'evt_123' }, {} as never);

		expect(mocks.getEvent).not.toHaveBeenCalled();
		expect(mocks.reconcileCustomer).not.toHaveBeenCalled();
	});

	it.each(CHECKOUT_EVENT_TYPES)('reconciles subscription state after %s', async (eventType) => {
		const subscription = {
			id: 'sub_cloud',
			customer: 'cus_cloud',
			metadata: { nao_org_id: 'org-id' },
			status: 'trialing',
		};
		mocks.getEvent.mockResolvedValue({
			type: eventType,
			data: { object: { id: 'cs_cloud', mode: 'subscription', metadata: { nao_plan_key: 'cloud_monthly_v2' } } },
		});
		mocks.getCheckoutSubscription.mockResolvedValue({
			session: {
				id: 'cs_cloud',
				client_reference_id: 'org-id',
				customer: 'cus_cloud',
				metadata: { nao_org_id: 'org-id', nao_plan_key: 'cloud_monthly_v2' },
				mode: 'subscription',
			},
			subscription,
		});
		await stripeWebhookProcessHandler({ eventId: 'evt_123' }, {} as never);

		expect(mocks.reconcileCustomer).toHaveBeenCalledWith({
			stripeCustomerId: 'cus_cloud',
			organizationIdHint: 'org-id',
		});
		expect(mocks.markProcessed).toHaveBeenCalledWith('evt_123');
	});

	it('rejects a Checkout Session whose Customer differs from its Subscription', async () => {
		mocks.getEvent.mockResolvedValue({
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_cloud',
					mode: 'subscription',
					metadata: { nao_plan_key: 'cloud_monthly_v2' },
				},
			},
		});
		mocks.getCheckoutSubscription.mockResolvedValue({
			session: {
				id: 'cs_cloud',
				client_reference_id: 'org-id',
				customer: 'cus_session',
				metadata: { nao_org_id: 'org-id', nao_plan_key: 'cloud_monthly_v2' },
				mode: 'subscription',
			},
			subscription: {
				id: 'sub_cloud',
				customer: 'cus_subscription',
				metadata: { nao_org_id: 'org-id' },
			},
		});

		await expect(stripeWebhookProcessHandler({ eventId: 'evt_123' }, {} as never)).rejects.toThrow(
			'Stripe Checkout Session "cs_cloud" has an unexpected Customer',
		);

		expect(mocks.reconcileCustomer).not.toHaveBeenCalled();
		expect(mocks.markFailed).toHaveBeenCalledWith(
			'evt_123',
			'Stripe Checkout Session "cs_cloud" has an unexpected Customer',
		);
		expect(mocks.markProcessed).not.toHaveBeenCalled();
	});

	it.each([
		['payment-mode', { id: 'cs_topup', mode: 'payment', metadata: {} }],
		['non-cloud plan', { id: 'cs_other', mode: 'subscription', metadata: { nao_plan_key: 'other_plan' } }],
	])('acknowledges Checkout sessions for a %s', async (_kind, session) => {
		mocks.getEvent.mockResolvedValue({
			type: 'checkout.session.completed',
			data: { object: session },
		});

		await stripeWebhookProcessHandler({ eventId: 'evt_123' }, {} as never);

		expect(mocks.getCheckoutSubscription).not.toHaveBeenCalled();
		expect(mocks.markProcessed).toHaveBeenCalledWith('evt_123');
	});

	it('reconciles subscription events by Customer', async () => {
		mocks.findSubscription.mockResolvedValue({
			id: 'sub_cloud',
			customer: 'cus_cloud',
			metadata: { nao_org_id: 'org-id' },
		});
		mocks.getEvent.mockResolvedValue({
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: 'sub_cloud',
				},
			},
		});

		await stripeWebhookProcessHandler({ eventId: 'evt_123' }, {} as never);

		expect(mocks.reconcileCustomer).toHaveBeenCalledWith({
			stripeCustomerId: 'cus_cloud',
			organizationIdHint: 'org-id',
		});
		expect(mocks.markProcessed).toHaveBeenCalledWith('evt_123');
	});

	it('reconciles from the stored object ID when the Stripe Event has expired', async () => {
		mocks.getInboxEvent.mockResolvedValue({
			id: 'evt_expired',
			type: 'customer.subscription.updated',
			stripeObjectId: 'sub_cloud',
			processedAt: null,
		});
		mocks.getEvent.mockRejectedValue({ statusCode: 404 });
		mocks.findSubscription.mockResolvedValue({
			id: 'sub_cloud',
			customer: 'cus_cloud',
			metadata: { nao_org_id: 'org-id' },
		});

		await stripeWebhookProcessHandler({ eventId: 'evt_expired' }, {} as never);

		expect(mocks.findSubscription).toHaveBeenCalledWith('sub_cloud');
		expect(mocks.reconcileCustomer).toHaveBeenCalledWith({
			stripeCustomerId: 'cus_cloud',
			organizationIdHint: 'org-id',
		});
		expect(mocks.markProcessed).toHaveBeenCalledWith('evt_expired');
	});

	it.each(CHECKOUT_EVENT_TYPES)('reconciles an expired %s event from its stored Session ID', async (eventType) => {
		mocks.getInboxEvent.mockResolvedValue({
			id: 'evt_expired',
			type: eventType,
			stripeObjectId: 'cs_cloud',
			processedAt: null,
		});
		mocks.getEvent.mockRejectedValue({ statusCode: 404 });
		mocks.getCheckoutSession.mockResolvedValue({
			id: 'cs_cloud',
			mode: 'subscription',
			metadata: { nao_plan_key: 'cloud_monthly_v2' },
		});
		mocks.getCheckoutSubscription.mockResolvedValue({
			session: {
				id: 'cs_cloud',
				client_reference_id: 'org-id',
				customer: 'cus_cloud',
				metadata: { nao_org_id: 'org-id', nao_plan_key: 'cloud_monthly_v2' },
				mode: 'subscription',
			},
			subscription: {
				id: 'sub_cloud',
				customer: 'cus_cloud',
				metadata: { nao_org_id: 'org-id' },
			},
		});

		await stripeWebhookProcessHandler({ eventId: 'evt_expired' }, {} as never);

		expect(mocks.getCheckoutSession).toHaveBeenCalledWith('cs_cloud');
		expect(mocks.getCheckoutSubscription).toHaveBeenCalledWith('cs_cloud');
		expect(mocks.reconcileCustomer).toHaveBeenCalledWith({
			stripeCustomerId: 'cus_cloud',
			organizationIdHint: 'org-id',
		});
	});

	it('reconciles an expired invoice event from its stored Invoice ID', async () => {
		mocks.getInboxEvent.mockResolvedValue({
			id: 'evt_expired',
			type: 'invoice.paid',
			stripeObjectId: 'in_cloud',
			processedAt: null,
		});
		mocks.getEvent.mockRejectedValue({ statusCode: 404 });
		mocks.getInvoice.mockResolvedValue({
			id: 'in_cloud',
			customer: 'cus_cloud',
			parent: { subscription_details: { subscription: 'sub_cloud' } },
		});
		mocks.findSubscription.mockResolvedValue({
			id: 'sub_cloud',
			customer: 'cus_cloud',
			metadata: { nao_org_id: 'org-id' },
		});

		await stripeWebhookProcessHandler({ eventId: 'evt_expired' }, {} as never);

		expect(mocks.getInvoice).toHaveBeenCalledWith('in_cloud');
		expect(mocks.reconcileCustomer).toHaveBeenCalledWith({
			stripeCustomerId: 'cus_cloud',
			organizationIdHint: 'org-id',
		});
	});

	it('scans mapped Customers for an expired PaymentMethod event with no current Customer', async () => {
		mocks.getInboxEvent.mockResolvedValue({
			id: 'evt_expired',
			type: 'payment_method.updated',
			stripeObjectId: 'pm_cloud',
			processedAt: null,
		});
		mocks.getEvent.mockRejectedValue({ statusCode: 404 });
		mocks.getPaymentMethod.mockResolvedValue({ id: 'pm_cloud', customer: null });
		mocks.listMappedOrganizations.mockResolvedValue([{ orgId: 'org-id', stripeCustomerId: 'cus_cloud' }]);

		await stripeWebhookProcessHandler({ eventId: 'evt_expired' }, {} as never);

		expect(mocks.getPaymentMethod).toHaveBeenCalledWith('pm_cloud');
		expect(mocks.reconcileCustomer).toHaveBeenCalledWith({
			stripeCustomerId: 'cus_cloud',
			organizationIdHint: 'org-id',
		});
	});

	it('reconciles an expired customer.updated event from its stored Customer ID', async () => {
		mocks.getInboxEvent.mockResolvedValue({
			id: 'evt_expired',
			type: 'customer.updated',
			stripeObjectId: 'cus_cloud',
			processedAt: null,
		});
		mocks.getEvent.mockRejectedValue({ statusCode: 404 });

		await stripeWebhookProcessHandler({ eventId: 'evt_expired' }, {} as never);

		expect(mocks.reconcileCustomer).toHaveBeenCalledWith({ stripeCustomerId: 'cus_cloud' });
		expect(mocks.markProcessed).toHaveBeenCalledWith('evt_expired');
	});

	it('scans mapped Customers for an expired payment_method.detached event', async () => {
		mocks.getInboxEvent.mockResolvedValue({
			id: 'evt_expired',
			type: 'payment_method.detached',
			stripeObjectId: 'pm_detached',
			processedAt: null,
		});
		mocks.getEvent.mockRejectedValue({ statusCode: 404 });
		mocks.listMappedOrganizations.mockResolvedValue([{ orgId: 'org-id', stripeCustomerId: 'cus_cloud' }]);

		await stripeWebhookProcessHandler({ eventId: 'evt_expired' }, {} as never);

		expect(mocks.getPaymentMethod).not.toHaveBeenCalled();
		expect(mocks.reconcileCustomer).toHaveBeenCalledWith({
			stripeCustomerId: 'cus_cloud',
			organizationIdHint: 'org-id',
		});
		expect(mocks.markProcessed).toHaveBeenCalledWith('evt_expired');
	});

	it('rejects a reconcilable stored event with no object ID', async () => {
		mocks.getInboxEvent.mockResolvedValue({
			id: 'evt_expired',
			type: 'invoice.paid',
			stripeObjectId: null,
			processedAt: null,
		});
		mocks.getEvent.mockRejectedValue({ statusCode: 404 });

		await expect(stripeWebhookProcessHandler({ eventId: 'evt_expired' }, {} as never)).rejects.toThrow(
			'Stored Stripe event "invoice.paid" has no object ID',
		);

		expect(mocks.getInvoice).not.toHaveBeenCalled();
		expect(mocks.markFailed).toHaveBeenCalledWith(
			'evt_expired',
			'Stored Stripe event "invoice.paid" has no object ID',
		);
	});

	it('does not use stored data for a transient Stripe Event retrieval failure', async () => {
		const error = new Error('Stripe is unavailable');
		mocks.getEvent.mockRejectedValue(error);

		await expect(stripeWebhookProcessHandler({ eventId: 'evt_123' }, {} as never)).rejects.toBe(error);

		expect(mocks.findSubscription).not.toHaveBeenCalled();
		expect(mocks.markFailed).toHaveBeenCalledWith('evt_123', 'Stripe is unavailable');
		expect(mocks.markProcessed).not.toHaveBeenCalled();
	});

	it.each([
		[
			'subscription',
			{
				type: 'customer.subscription.updated',
				data: {
					object: {
						id: 'sub_unrelated',
						customer: 'cus_unrelated',
						metadata: { nao_org_id: 'org-id' },
					},
				},
			},
		],
		[
			'invoice',
			{
				type: 'invoice.paid',
				data: {
					object: {
						id: 'in_unrelated',
						customer: 'cus_unrelated',
						parent: {
							subscription_details: {
								subscription: 'sub_unrelated',
								metadata: { nao_org_id: 'org-id' },
							},
						},
					},
				},
			},
		],
	])('acknowledges an unrelated %s event without trusting its organization metadata', async (_kind, event) => {
		mocks.findSubscription.mockResolvedValue(null);
		mocks.getEvent.mockResolvedValue(event);

		await stripeWebhookProcessHandler({ eventId: 'evt_123' }, {} as never);

		expect(mocks.reconcileCustomer).not.toHaveBeenCalled();
		expect(mocks.markProcessed).toHaveBeenCalledWith('evt_123');
	});

	it('reconciles invoice events without a Customer from the validated subscription', async () => {
		mocks.findSubscription.mockResolvedValue({
			id: 'sub_cloud',
			customer: 'cus_cloud',
			metadata: { nao_org_id: 'org-id' },
		});
		mocks.getEvent.mockResolvedValue({
			type: 'invoice.paid',
			data: {
				object: {
					id: 'in_cloud',
					parent: {
						subscription_details: {
							subscription: 'sub_cloud',
							metadata: { nao_org_id: 'org-spoofed' },
						},
					},
				},
			},
		});

		await stripeWebhookProcessHandler({ eventId: 'evt_123' }, {} as never);

		expect(mocks.reconcileCustomer).toHaveBeenCalledWith({
			stripeCustomerId: 'cus_cloud',
			organizationIdHint: 'org-id',
		});
		expect(mocks.markProcessed).toHaveBeenCalledWith('evt_123');
	});

	it('projects the latest Customer payment-method state', async () => {
		mocks.getEvent.mockResolvedValue({
			type: 'customer.updated',
			data: { object: { id: 'cus_cloud' } },
		});
		await stripeWebhookProcessHandler({ eventId: 'evt_123' }, {} as never);

		expect(mocks.reconcileCustomer).toHaveBeenCalledWith({ stripeCustomerId: 'cus_cloud' });
		expect(mocks.markProcessed).toHaveBeenCalledWith('evt_123');
	});

	it('reconciles all mapped Customers when a detached PaymentMethod has no Customer', async () => {
		mocks.getEvent.mockResolvedValue({
			type: 'payment_method.detached',
			data: { object: { id: 'pm_detached', customer: null } },
		});
		mocks.listMappedOrganizations.mockResolvedValue([
			{ orgId: 'org-one', stripeCustomerId: 'cus_one' },
			{ orgId: 'org-two', stripeCustomerId: 'cus_two' },
		]);

		await stripeWebhookProcessHandler({ eventId: 'evt_123' }, {} as never);

		expect(mocks.reconcileCustomer).toHaveBeenNthCalledWith(1, {
			stripeCustomerId: 'cus_one',
			organizationIdHint: 'org-one',
		});
		expect(mocks.reconcileCustomer).toHaveBeenNthCalledWith(2, {
			stripeCustomerId: 'cus_two',
			organizationIdHint: 'org-two',
		});
		expect(mocks.markProcessed).toHaveBeenCalledWith('evt_123');
	});

	it('keeps reconciling other mapped Customers when one fails, then fails the event', async () => {
		mocks.getEvent.mockResolvedValue({
			type: 'payment_method.detached',
			data: { object: { id: 'pm_detached', customer: null } },
		});
		mocks.listMappedOrganizations.mockResolvedValue([
			{ orgId: 'org-one', stripeCustomerId: 'cus_one' },
			{ orgId: 'org-two', stripeCustomerId: 'cus_two' },
		]);
		mocks.reconcileCustomer.mockRejectedValueOnce(new Error('org-one unavailable'));

		await expect(stripeWebhookProcessHandler({ eventId: 'evt_123' }, {} as never)).rejects.toThrow(
			'Reconciliation failed for 1 organization(s): org-one: org-one unavailable',
		);

		expect(mocks.reconcileCustomer).toHaveBeenCalledWith({
			stripeCustomerId: 'cus_two',
			organizationIdHint: 'org-two',
		});
		expect(mocks.markFailed).toHaveBeenCalledWith('evt_123', expect.stringContaining('org-one unavailable'));
		expect(mocks.markProcessed).not.toHaveBeenCalled();
	});

	it('reconciles the former Customer from a detached PaymentMethod event when available', async () => {
		mocks.getEvent.mockResolvedValue({
			type: 'payment_method.detached',
			data: {
				object: { id: 'pm_detached', customer: null },
				previous_attributes: { customer: 'cus_cloud' },
			},
		});

		await stripeWebhookProcessHandler({ eventId: 'evt_123' }, {} as never);

		expect(mocks.reconcileCustomer).toHaveBeenCalledWith({ stripeCustomerId: 'cus_cloud' });
		expect(mocks.listMappedOrganizations).not.toHaveBeenCalled();
		expect(mocks.markProcessed).toHaveBeenCalledWith('evt_123');
	});

	it('marks an event failed and rethrows when reconciliation fails', async () => {
		const error = new Error('reconciliation failed');
		mocks.getEvent.mockResolvedValue({
			type: 'customer.updated',
			data: { object: { id: 'cus_cloud' } },
		});
		mocks.reconcileCustomer.mockRejectedValue(error);

		await expect(stripeWebhookProcessHandler({ eventId: 'evt_123' }, {} as never)).rejects.toBe(error);

		expect(mocks.markFailed).toHaveBeenCalledWith('evt_123', 'reconciliation failed');
		expect(mocks.markProcessed).not.toHaveBeenCalled();
	});
});
