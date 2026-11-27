import type { UIMessageChunk } from 'ai';

/**
 * Reads a run's stream to its end without building a snapshot of the message after each chunk, which clones every
 * tool output of the message and blocks the event loop on large query results.
 */
export async function drainUIMessageStream<Chunk extends UIMessageChunk>(stream: ReadableStream<Chunk>): Promise<void> {
	const reader = stream.getReader();
	for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
		if (chunk.value.type === 'error') {
			throw new Error(chunk.value.errorText);
		}
	}
}
