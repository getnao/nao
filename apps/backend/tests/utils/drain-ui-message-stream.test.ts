import type { UIMessageChunk } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { drainUIMessageStream } from '../../src/utils/drain-ui-message-stream';

const rows = Array.from({ length: 500 }, (_, index) => ({ id: index, name: `customer ${index}` }));

const answerChunks: UIMessageChunk[] = [
	{ type: 'start' },
	{ type: 'tool-input-available', toolCallId: 'call_1', toolName: 'execute_sql', input: { sql_query: 'select 1' } },
	{ type: 'tool-output-available', toolCallId: 'call_1', output: { data: rows } },
	{ type: 'text-start', id: 'text' },
	...Array.from({ length: 100 }, (): UIMessageChunk => ({ type: 'text-delta', id: 'text', delta: 'token ' })),
	{ type: 'text-end', id: 'text' },
	{ type: 'finish' },
];

describe('drainUIMessageStream', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('reads every chunk without cloning the message', async () => {
		const structuredCloneSpy = vi.spyOn(globalThis, 'structuredClone');
		const source = countedStream(answerChunks);

		await drainUIMessageStream(source.stream);

		expect(source.readCount()).toBe(answerChunks.length);
		expect(structuredCloneSpy).not.toHaveBeenCalled();
	});

	it('rejects with the text of an error chunk', async () => {
		const source = countedStream([{ type: 'start' }, { type: 'error', errorText: 'Model overloaded' }]);

		await expect(drainUIMessageStream(source.stream)).rejects.toThrow('Model overloaded');
	});
});

function countedStream(chunks: UIMessageChunk[]) {
	let index = 0;
	const stream = new ReadableStream<UIMessageChunk>({
		pull(controller) {
			if (index === chunks.length) {
				controller.close();
				return;
			}
			controller.enqueue(chunks[index]);
			index += 1;
		},
	});
	return { stream, readCount: () => index };
}
