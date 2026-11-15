import { describe, expect, it, vi } from 'vitest';

import type { AgentStreamRelay, UIMessageChunk } from '../../src/services/agent-stream-relay';

vi.mock('../../src/services/agent', () => ({ agentService: { get: vi.fn() } }));
vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

const { AgentStreamService, FAILED_STREAM_MESSAGE } = await import('../../src/services/agent-stream');

const START: UIMessageChunk = { type: 'start', messageId: 'assistant-message' };
const TEXT: UIMessageChunk = { type: 'text-delta', id: 'text-1', delta: 'Revenue grew.' };
const FINISH: UIMessageChunk = { type: 'finish' };

describe('AgentStreamService', () => {
	it('runs the agent stream to its end after the first reader leaves, for a reader who reconnects', async () => {
		const service = new AgentStreamService(null);
		const agentStream = controllableStream();
		const firstReader = service.open('chat-1', 'user-1').start(agentStream.stream).getReader();
		agentStream.push(START);
		await firstReader.read();
		await firstReader.cancel();

		const reconnected = await service.read('chat-1');
		agentStream.push(TEXT);
		agentStream.push(FINISH);
		agentStream.close();

		expect(await Array.fromAsync(reconnected!)).toEqual([START, TEXT, FINISH]);
	});

	it('lets a reader follow a run whose agent is still being set up', async () => {
		const service = new AgentStreamService(null);
		const answer = service.open('chat-1', 'user-1');
		const reconnected = await service.read('chat-1');
		const reading = Array.fromAsync(reconnected!);

		const agentStream = controllableStream();
		void Array.fromAsync(answer.start(agentStream.stream));
		agentStream.push(START);
		agentStream.push(FINISH);
		agentStream.close();

		expect(await reading).toEqual([START, FINISH]);
	});

	it('ends the readers of a run whose agent failed to be set up with an error', async () => {
		const service = new AgentStreamService(null);
		const answer = service.open('chat-1', 'user-1');
		const reading = Array.fromAsync((await service.read('chat-1'))!);

		answer.fail();

		expect(await reading).toEqual([{ type: 'error', errorText: FAILED_STREAM_MESSAGE }]);
		await vi.waitFor(async () => expect(await service.read('chat-1')).toBeNull());
	});

	it('brings a run back once the newer run of its chat that replaced it fails', async () => {
		const reclaim = vi.fn(async () => {});
		const relay = {
			publish: vi.fn(async () => ({ end: vi.fn(async () => {}), reclaim })),
		} as unknown as AgentStreamRelay;
		const service = new AgentStreamService(relay);
		const firstAgentStream = controllableStream();
		void Array.fromAsync(service.open('chat-1', 'user-1').start(firstAgentStream.stream));
		firstAgentStream.push(START);

		service.open('chat-1', 'user-1').fail();

		await vi.waitFor(() => expect(reclaim).toHaveBeenCalledOnce());
		const reconnected = await service.read('chat-1');
		firstAgentStream.push(FINISH);
		firstAgentStream.close();
		expect(await Array.fromAsync(reconnected!)).toEqual([START, FINISH]);
	});

	it('has no stream to read for a chat once its run ended', async () => {
		const service = new AgentStreamService(null);
		const agentStream = controllableStream();
		const reading = Array.fromAsync(service.open('chat-1', 'user-1').start(agentStream.stream));
		agentStream.close();
		await reading;

		await vi.waitFor(async () => expect(await service.read('chat-1')).toBeNull());
	});

	it('ends with an error chunk when the agent stream fails', async () => {
		const service = new AgentStreamService(null);
		const agentStream = controllableStream();
		const reading = Array.fromAsync(service.open('chat-1', 'user-1').start(agentStream.stream));

		agentStream.push(START);
		agentStream.fail(new Error('provider went away'));

		expect(await reading).toEqual([START, { type: 'error', errorText: FAILED_STREAM_MESSAGE }]);
	});

	it("lists the user's running chats, from this instance and from the relay", async () => {
		const relay = {
			publish: vi.fn(async () => ({ end: vi.fn(async () => {}) })),
			listLiveChatIds: vi.fn(async () => ['chat-mine', 'chat-elsewhere']),
		} as unknown as AgentStreamRelay;
		const service = new AgentStreamService(relay);
		const mine = controllableStream();
		const someoneElses = controllableStream();
		const readings = [
			Array.fromAsync(service.open('chat-mine', 'user-1').start(mine.stream)),
			Array.fromAsync(service.open('chat-theirs', 'user-2').start(someoneElses.stream)),
		];

		expect(await service.listRunningChatIds('user-1')).toEqual(['chat-mine', 'chat-elsewhere']);
		expect(relay.listLiveChatIds).toHaveBeenCalledWith('user-1');

		mine.close();
		someoneElses.close();
		await Promise.all(readings);
	});

	it('publishes the run to the relay and ends it there, and reads chats it does not run through it', async () => {
		const relayedStream = new ReadableStream<UIMessageChunk>();
		const end = vi.fn(async () => {});
		const relay = {
			publish: vi.fn(async () => ({ end })),
			read: vi.fn(async () => relayedStream),
		} as unknown as AgentStreamRelay;
		const service = new AgentStreamService(relay);
		const agentStream = controllableStream();

		const reading = Array.fromAsync(service.open('chat-1', 'user-1').start(agentStream.stream));
		expect(await service.read('chat-elsewhere')).toBe(relayedStream);
		agentStream.close();
		await reading;

		expect(relay.publish).toHaveBeenCalledWith('chat-1', expect.any(String), expect.anything());
		await vi.waitFor(() => expect(end).toHaveBeenCalledOnce());
	});
});

function controllableStream() {
	let controller!: ReadableStreamDefaultController<UIMessageChunk>;
	const stream = new ReadableStream<UIMessageChunk>({
		start: (streamController) => {
			controller = streamController;
		},
	});
	return {
		stream,
		push: (chunk: UIMessageChunk) => controller.enqueue(chunk),
		close: () => controller.close(),
		fail: (error: Error) => controller.error(error),
	};
}
