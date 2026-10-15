import { EventEmitter } from 'node:events';

import type { FastifyReply, FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackAgentStreamDisconnect } from '../../src/utils/agent-stream-disconnect';
import { logger } from '../../src/utils/logger';

vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

describe('trackAgentStreamDisconnect', () => {
	beforeEach(() => {
		vi.mocked(logger.error).mockClear();
	});

	it('logs when the client disconnects before the response is complete', async () => {
		const setup = createSetup();

		await setup.readFirstChunk();
		setup.closeConnection({ writableFinished: false });
		await setup.finishRun();

		expect(logger.error).toHaveBeenCalledWith(
			'Agent stream connection closed before the response was complete',
			expect.objectContaining({
				source: 'agent',
				projectId: 'project-1',
				context: expect.objectContaining({
					chatId: 'chat-1',
					userId: 'user-1',
					modelId: 'model-1',
					userAgent: 'test-browser',
					host: 'nao.example.com',
				}),
			}),
		);
	});

	it('does not log when the user stopped the agent', async () => {
		const setup = createSetup();

		await setup.readFirstChunk();
		setup.closeConnection({ writableFinished: false });
		setup.agent.isStopped = true;
		await setup.finishRun();

		expect(logger.error).not.toHaveBeenCalled();
	});

	it('does not log when the response completed', async () => {
		const setup = createSetup();

		await setup.readFirstChunk();
		setup.closeConnection({ writableFinished: true });
		await setup.finishRun();

		expect(logger.error).not.toHaveBeenCalled();
	});

	it('waits for the run to end before deciding', async () => {
		const setup = createSetup();

		await setup.readFirstChunk();
		setup.closeConnection({ writableFinished: false });
		await flushPromises();

		expect(logger.error).not.toHaveBeenCalled();
		await setup.finishRun();
		expect(logger.error).toHaveBeenCalledOnce();
	});
});

function createSetup() {
	const raw = Object.assign(new EventEmitter(), { writableFinished: false });
	let resolveFinished: () => void = () => {};
	const finished = new Promise<void>((resolve) => {
		resolveFinished = resolve;
	});
	const agent = { isStopped: false, waitUntilFinished: () => finished };
	const source = new ReadableStream<string>({
		start(controller) {
			controller.enqueue('chunk');
		},
	});

	const stream = trackAgentStreamDisconnect(source, {
		request: { headers: { 'user-agent': 'test-browser', 'x-forwarded-host': 'nao.example.com' } } as FastifyRequest,
		reply: { raw } as unknown as FastifyReply,
		agent,
		userId: 'user-1',
		projectId: 'project-1',
		chatId: 'chat-1',
		modelId: 'model-1',
	});

	return {
		agent,
		readFirstChunk: () => stream.getReader().read(),
		closeConnection: ({ writableFinished }: { writableFinished: boolean }) => {
			raw.writableFinished = writableFinished;
			raw.emit('close');
		},
		finishRun: async () => {
			resolveFinished();
			await flushPromises();
		},
	};
}

function flushPromises() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}
