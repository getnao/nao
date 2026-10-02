import { beforeEach, describe, expect, it, vi } from 'vitest';

const testMocks = vi.hoisted(() => ({
	constructEventAsync: vi.fn(),
	enqueueOnce: vi.fn(),
	insertEvent: vi.fn(),
	post: vi.fn(),
}));
const testState = vi.hoisted(() => ({ secretKey: 'sk_test_sandbox' }));

vi.mock('../src/env', () => ({
	env: {
		get STRIPE_SECRET_KEY() {
			return testState.secretKey;
		},
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
		testState.secretKey = 'sk_test_sandbox';
		await stripeWebhookRoutes({ post: testMocks.post } as never);
	});

	it.each([
		['signature header', { headers: {}, rawBody: '{}' }],
		['raw body', { headers: { 'stripe-signature': 'valid' } }],
	])('rejects a missing %s without verifying or persisting work', async (_missingField, request) => {
		const response = await handler()(request, reply());

		expect(response.statusCode).toBe(400);
		expect(testMocks.constructEventAsync).not.toHaveBeenCalled();
		expect(testMocks.insertEvent).not.toHaveBeenCalled();
		expect(testMocks.enqueueOnce).not.toHaveBeenCalled();
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

	it.each([
		['live event with a test key', 'sk_test_sandbox', true],
		['test event with a live key', 'sk_live_production', false],
		['test event with a live restricted key', 'rk_live_production', false],
	])('rejects a %s without persisting work', async (_name, secretKey, livemode) => {
		testState.secretKey = secretKey;
		testMocks.constructEventAsync.mockResolvedValue({
			id: 'evt_mismatch',
			type: 'checkout.session.completed',
			livemode,
			data: { object: { id: 'cs_mismatch' } },
		});

		const response = await handler()({ headers: { 'stripe-signature': 'valid' }, rawBody: '{}' }, reply());

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
		request: { headers: Record<string, string>; rawBody?: string },
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
