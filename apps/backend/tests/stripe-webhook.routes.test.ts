import { beforeEach, describe, expect, it, vi } from 'vitest';

const testMocks = vi.hoisted(() => ({
	constructEventAsync: vi.fn(),
	enqueueOnce: vi.fn(),
	insertEvent: vi.fn(),
	post: vi.fn(),
}));

vi.mock('../src/env', () => ({
	env: {
		MODE: 'dev',
		STRIPE_WEBHOOK_SECRET: 'whsec_test',
	},
}));

vi.mock('../src/queries/billing.queries', () => ({
	insertStripeWebhookEvent: testMocks.insertEvent,
}));

vi.mock('../src/services/scheduler.service', () => ({
	enqueueOnce: testMocks.enqueueOnce,
}));

vi.mock('../src/services/stripe.service', () => ({
	getStripeClient: () => ({ webhooks: { constructEventAsync: testMocks.constructEventAsync } }),
}));

vi.mock('../src/utils/logger', () => ({
	logger: { warn: vi.fn() },
}));

import { stripeWebhookRoutes } from '../src/routes/stripe-webhook';

describe('Stripe webhook route', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		await stripeWebhookRoutes({ post: testMocks.post } as never);
	});

	it('rejects an invalid signature without persisting work', async () => {
		testMocks.constructEventAsync.mockImplementation(() => {
			throw new Error('invalid signature');
		});

		const response = await handler()({ headers: { 'stripe-signature': 'invalid' }, rawBody: '{}' }, reply());

		expect(response.statusCode).toBe(400);
		expect(testMocks.insertEvent).not.toHaveBeenCalled();
		expect(testMocks.enqueueOnce).not.toHaveBeenCalled();
	});

	it('acknowledges a duplicate only after repairing its durable enqueue', async () => {
		testMocks.constructEventAsync.mockResolvedValue({
			id: 'evt_123',
			type: 'checkout.session.completed',
			livemode: false,
			data: { object: { id: 'cs_123' } },
		});
		testMocks.insertEvent.mockResolvedValue(null);

		const response = await handler()({ headers: { 'stripe-signature': 'valid' }, rawBody: '{}' }, reply());

		expect(testMocks.insertEvent).toHaveBeenCalledWith({
			id: 'evt_123',
			type: 'checkout.session.completed',
			stripeObjectId: 'cs_123',
			livemode: false,
		});
		expect(testMocks.enqueueOnce).toHaveBeenCalledWith({
			name: 'stripe.webhook',
			payload: { eventId: 'evt_123' },
			uniqueKey: 'stripe-event:evt_123',
			maxAttempts: 10,
		});
		expect(response.statusCode).toBe(200);
	});
});

function handler() {
	return testMocks.post.mock.calls[0][2] as (
		request: { headers: Record<string, string>; rawBody: string },
		response: ReturnType<typeof reply>,
	) => Promise<ReturnType<typeof reply>>;
}

function reply() {
	return {
		statusCode: 200,
		body: undefined as unknown,
		status(code: number) {
			this.statusCode = code;
			return this;
		},
		send(body: unknown) {
			this.body = body;
			return this;
		},
	};
}
