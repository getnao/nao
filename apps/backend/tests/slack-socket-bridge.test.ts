import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@slack/socket-mode', () => ({
	SocketModeClient: vi.fn().mockImplementation(function () {
		return {
			disconnect: vi.fn(),
			on: vi.fn(),
			start: vi.fn(),
		};
	}),
}));

vi.mock('../src/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	},
}));

import { SlackSocketBridge } from '../src/services/slack-socket-bridge';

interface TestSlackSocketEvent {
	envelope_id: string;
	type: string;
	body: Record<string, unknown>;
	accepts_response_payload?: boolean;
	ack: (response?: unknown) => Promise<void>;
}

interface TestBridge {
	_handleEvent(event: TestSlackSocketEvent): Promise<void>;
}

describe('SlackSocketBridge', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('acks events without response payload support before dispatching to the adapter', async () => {
		const response = createDeferred<Response>();
		const webhooks = createSlackWebhooks(vi.fn(() => response.promise));
		const bridge = createBridge(webhooks);
		const event = createSocketEvent({ acceptsResponsePayload: false });

		const handlePromise = bridge._handleEvent(event);

		expect(event.ack).toHaveBeenCalledWith(undefined);
		expect(webhooks.slack).not.toHaveBeenCalled();

		await Promise.resolve();
		await Promise.resolve();

		expect(webhooks.slack).toHaveBeenCalledTimes(1);

		response.resolve(new Response('', { status: 200 }));
		await handlePromise;
	});

	it('forwards fast adapter responses as ack payloads when Slack accepts them', async () => {
		const webhooks = createSlackWebhooks(
			vi.fn(() => Promise.resolve(new Response(JSON.stringify({ action: 'clear' }), { status: 200 }))),
		);
		const bridge = createBridge(webhooks);
		const event = createSocketEvent({ acceptsResponsePayload: true });

		await bridge._handleEvent(event);

		expect(event.ack).toHaveBeenCalledWith({ action: 'clear' });
	});

	it('acks payload-capable events without payload when adapter handling exceeds the ack deadline', async () => {
		vi.useFakeTimers();
		const response = createDeferred<Response>();
		const webhooks = createSlackWebhooks(vi.fn(() => response.promise));
		const bridge = createBridge(webhooks);
		const event = createSocketEvent({ acceptsResponsePayload: true });

		const handlePromise = bridge._handleEvent(event);
		await Promise.resolve();

		expect(event.ack).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(2500);
		await handlePromise;

		expect(event.ack).toHaveBeenCalledWith(undefined);

		response.resolve(new Response(JSON.stringify({ action: 'clear' }), { status: 200 }));
		await Promise.resolve();
	});
});

function createBridge(webhooks: { slack: ReturnType<typeof vi.fn> }): TestBridge {
	return new SlackSocketBridge({
		appToken: 'xapp-test',
		projectId: 'project-test',
		signingSecret: 'secret',
		webhooks: webhooks as never,
	}) as unknown as TestBridge;
}

function createSlackWebhooks(slack: ReturnType<typeof vi.fn>) {
	return { slack };
}

function createSocketEvent(options: { acceptsResponsePayload: boolean }): TestSlackSocketEvent {
	return {
		ack: vi.fn().mockResolvedValue(undefined),
		accepts_response_payload: options.acceptsResponsePayload,
		body: { event: { type: 'app_mention' }, type: 'event_callback' },
		envelope_id: 'envelope-test',
		type: 'events_api',
	};
}

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, reject, resolve };
}
