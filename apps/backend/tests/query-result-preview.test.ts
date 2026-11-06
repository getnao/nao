import type { InferUIMessageChunk } from 'ai';
import { describe, expect, it } from 'vitest';

import type { UIMessage } from '../src/types/chat';
import {
	QUERY_RESULT_PREVIEW_ROWS,
	withQueryResultPreviewsInChat,
	withQueryResultPreviewsInStream,
} from '../src/utils/query-result-preview';

type UIMessageChunk = InferUIMessageChunk<UIMessage>;

describe('withQueryResultPreviewsInStream', () => {
	it('keeps only the first rows of a large query result', async () => {
		const output = queryOutput(QUERY_RESULT_PREVIEW_ROWS * 3);

		const chunks = await readAll(
			withQueryResultPreviewsInStream(
				streamOf([
					{ type: 'tool-input-start', toolCallId: 'call-1', toolName: 'execute_sql' },
					{ type: 'tool-output-available', toolCallId: 'call-1', output },
				]),
			),
		);

		expect(chunks[1]).toEqual({
			type: 'tool-output-available',
			toolCallId: 'call-1',
			output: { ...output, data: output.data.slice(0, QUERY_RESULT_PREVIEW_ROWS), is_preview: true },
		});
	});

	it('leaves small query results and other tools untouched', async () => {
		const smallOutput = queryOutput(QUERY_RESULT_PREVIEW_ROWS);
		const otherToolOutput = queryOutput(QUERY_RESULT_PREVIEW_ROWS * 3);
		const input: UIMessageChunk[] = [
			{ type: 'tool-input-start', toolCallId: 'call-1', toolName: 'execute_semantic_query' },
			{ type: 'tool-output-available', toolCallId: 'call-1', output: smallOutput },
			{ type: 'tool-input-start', toolCallId: 'call-2', toolName: 'page_query_result' },
			{ type: 'tool-output-available', toolCallId: 'call-2', output: otherToolOutput },
		];

		expect(await readAll(withQueryResultPreviewsInStream(streamOf(input)))).toEqual(input);
	});
});

describe('withQueryResultPreviewsInChat', () => {
	it('keeps only the first rows of large query results in the messages', () => {
		const output = queryOutput(QUERY_RESULT_PREVIEW_ROWS + 1);
		const chat = {
			messages: [
				{
					id: 'message-1',
					role: 'assistant',
					parts: [
						{ type: 'text', text: 'Here are the orders' },
						{
							type: 'tool-execute_sql',
							toolCallId: 'call-1',
							state: 'output-available',
							input: { sql_query: 'select 1' },
							output,
						},
					],
				},
			],
		} as unknown as { messages: UIMessage[] };

		const [textPart, queryPart] = withQueryResultPreviewsInChat(chat).messages[0].parts;

		expect(textPart).toEqual({ type: 'text', text: 'Here are the orders' });
		expect(queryPart).toMatchObject({ output: { row_count: QUERY_RESULT_PREVIEW_ROWS + 1, is_preview: true } });
		expect((queryPart as { output: { data: unknown[] } }).output.data).toHaveLength(QUERY_RESULT_PREVIEW_ROWS);
		expect(chat.messages[0].parts[1]).toMatchObject({
			output: { data: queryOutput(QUERY_RESULT_PREVIEW_ROWS + 1).data },
		});
	});
});

function queryOutput(rowCount: number) {
	const data = Array.from({ length: rowCount }, (_, index) => ({ id: index }));
	return { _version: '1' as const, data, row_count: rowCount, columns: ['id'], id: 'query_abc' };
}

function streamOf(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
	return new ReadableStream({
		start(controller) {
			chunks.forEach((chunk) => controller.enqueue(chunk));
			controller.close();
		},
	});
}

async function readAll(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
	const chunks: UIMessageChunk[] = [];
	for await (const chunk of stream) {
		chunks.push(chunk);
	}
	return chunks;
}
