import type { TextStreamPart, ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';

import { normalizeCitationMarkersStream } from '../../src/utils/citation-markers-stream';

type Part = TextStreamPart<ToolSet>;

describe('normalizeCitationMarkersStream', () => {
	it('restores a citation tag whose marker and name arrive in separate deltas', async () => {
		const parts = await streamText([
			'Total: \uE200',
			'citation',
			'-number id="query_a" column="total">99</citation-number>',
		]);

		expect(textOf(parts)).toBe('Total: <citation-number id="query_a" column="total">99</citation-number>');
		expect(textOf(parts)).not.toMatch(/[\uE200-\uE202]/);
	});

	it('drops a ChatGPT citation streamed over several deltas', async () => {
		const parts = await streamText(['Revenue was 622. \uE200cite', '\uE202turn_e2bf', '7643\uE201 It grew.']);

		expect(textOf(parts)).toBe('Revenue was 622. It grew.');
	});

	it('flushes a marker that never resolves before the text ends', async () => {
		const parts = await streamText(['Total: 99 \uE200cit']);

		expect(textOf(parts)).toBe('Total: 99 cit');
		expect(parts.at(-1)).toEqual({ type: 'text-end', id: 'text-1' });
	});

	it('passes text without markers through unchanged', async () => {
		const deltas = ['Omsætningen ', 'steg med 49,9 %.'];
		const parts = await streamText(deltas);

		expect(parts.filter((part) => part.type === 'text-delta').map((part) => part.text)).toEqual(deltas);
	});
});

async function streamText(deltas: string[]): Promise<Part[]> {
	const input: Part[] = [
		{ type: 'text-start', id: 'text-1' },
		...deltas.map((text): Part => ({ type: 'text-delta', id: 'text-1', text })),
		{ type: 'text-end', id: 'text-1' },
	];
	const transform = normalizeCitationMarkersStream<ToolSet>()({ tools: {}, stopStream: () => {} });
	const output: Part[] = [];
	for await (const part of ReadableStream.from(input).pipeThrough(transform)) {
		output.push(part);
	}
	return output;
}

function textOf(parts: Part[]): string {
	return parts.map((part) => (part.type === 'text-delta' ? part.text : '')).join('');
}
