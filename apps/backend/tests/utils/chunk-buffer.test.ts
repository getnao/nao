import { describe, expect, it } from 'vitest';

import { ChunkBuffer } from '../../src/utils/chunk-buffer';

describe('ChunkBuffer', () => {
	it('replays earlier chunks to a late reader and then follows the live ones', async () => {
		const buffer = new ChunkBuffer<string>();
		buffer.push('first');
		const reading = readAll(buffer.read());

		buffer.push('second');
		buffer.close();

		expect(await reading).toEqual(['first', 'second']);
		expect(await readAll(buffer.read())).toEqual(['first', 'second']);
	});

	it('hands every chunk past an index in one batch, waiting for one when there are none yet', async () => {
		const buffer = new ChunkBuffer<string>();
		buffer.push('first');
		const waiting = buffer.next(1);

		buffer.push('second');
		buffer.push('third');

		expect(await waiting).toEqual({ chunks: ['second', 'third'], isClosed: false });
		expect(await buffer.next(0)).toEqual({ chunks: ['first', 'second', 'third'], isClosed: false });
	});

	it('keeps buffering for other readers after one reader cancels', async () => {
		const buffer = new ChunkBuffer<string>();
		const leavingReader = buffer.read().getReader();
		const firstRead = leavingReader.read();
		buffer.push('first');
		await firstRead;
		await leavingReader.cancel();

		buffer.push('second');
		buffer.close();

		expect(await readAll(buffer.read())).toEqual(['first', 'second']);
	});
});

async function readAll<T>(stream: ReadableStream<T>): Promise<T[]> {
	return Array.fromAsync(stream);
}
