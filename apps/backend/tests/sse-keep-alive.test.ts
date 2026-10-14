import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SSE_KEEP_ALIVE_COMMENT, withSseKeepAlive } from '../src/utils/sse-keep-alive';

const INTERVAL_MS = 10_000;

describe('withSseKeepAlive', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('passes chunks through unchanged', async () => {
		const { source, output } = createStreams();

		source.enqueue('data: {"type":"start"}\n\n');
		source.close();

		expect(await readAll(output)).toEqual(['data: {"type":"start"}\n\n']);
	});

	it('writes a keep-alive comment after each silent interval', async () => {
		const { output } = createStreams();
		const reader = output.getReader();

		await vi.advanceTimersByTimeAsync(INTERVAL_MS);
		expect(await reader.read()).toEqual({ done: false, value: SSE_KEEP_ALIVE_COMMENT });

		await vi.advanceTimersByTimeAsync(INTERVAL_MS);
		expect(await reader.read()).toEqual({ done: false, value: SSE_KEEP_ALIVE_COMMENT });
	});

	it('restarts the silence timer on every chunk', async () => {
		const { source, output } = createStreams();
		const reader = output.getReader();

		await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1_000);
		source.enqueue('data: chunk\n\n');
		expect(await reader.read()).toEqual({ done: false, value: 'data: chunk\n\n' });

		await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1_000);
		source.close();
		expect(await reader.read()).toEqual({ done: true, value: undefined });
	});

	it('does not queue keep-alives while the consumer is not reading', async () => {
		const { source, output } = createStreams();

		await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);
		source.enqueue('data: chunk\n\n');
		source.close();

		expect(await readAll(output)).toEqual([SSE_KEEP_ALIVE_COMMENT, 'data: chunk\n\n']);
	});

	it('stops the timer once the stream ends', async () => {
		const { source, output } = createStreams();

		source.close();
		await readAll(output);

		expect(vi.getTimerCount()).toBe(0);
	});

	it('stops the timer and cancels the source when the client goes away', async () => {
		const cancel = vi.fn();
		const source = new ReadableStream<string>({ cancel });
		const output = withSseKeepAlive(source, INTERVAL_MS);

		await output.cancel('client disconnected');

		expect(cancel).toHaveBeenCalledWith('client disconnected');
		expect(vi.getTimerCount()).toBe(0);
	});
});

function createStreams() {
	let source!: ReadableStreamDefaultController<string>;
	const stream = new ReadableStream<string>({
		start(controller) {
			source = controller;
		},
	});
	return { source, output: withSseKeepAlive(stream, INTERVAL_MS) };
}

async function readAll(stream: ReadableStream<string>): Promise<string[]> {
	const chunks: string[] = [];
	for await (const chunk of stream) {
		chunks.push(chunk);
	}
	return chunks;
}
