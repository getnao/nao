import type { UIMessageStreamWriter } from 'ai';

import type { UIMessage } from '../../src/types/chat';

type WrittenChunk = { type: string; delta?: string; toolName?: string; input?: unknown };

/** A stream writer that records the chunks written to it. */
export function createUIMessageWriter() {
	const chunks: WrittenChunk[] = [];
	const writer: UIMessageStreamWriter<UIMessage> = {
		write: (chunk) => {
			chunks.push(chunk as WrittenChunk);
		},
		merge: () => {},
		onError: undefined,
	};
	return {
		writer,
		chunks,
		types: () => chunks.map((chunk) => chunk.type),
		text: () => chunks.find((chunk) => chunk.type === 'text-delta')?.delta,
		toolName: () => chunks.find((chunk) => chunk.type === 'tool-input-available')?.toolName,
	};
}
