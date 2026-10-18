import { crc32 } from 'node:zlib';

import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { streamText } from 'ai';
import { describe, expect, it, vi } from 'vitest';

const REDACTED_CHUNKS = ['c3ludGhl', 'dGlj'];
const REDACTED_CONTENT = REDACTED_CHUNKS.join('');

/** Encode the AWS event-stream envelope so the real Bedrock transport/parser is exercised. */
function encodeEvent(eventType: string, payload: object): Buffer {
	const headers = Object.entries({
		':message-type': 'event',
		':event-type': eventType,
		':content-type': 'application/json',
	}).map(([name, value]) => {
		const nameBytes = Buffer.from(name);
		const valueBytes = Buffer.from(value);
		const valueLength = Buffer.alloc(2);
		valueLength.writeUInt16BE(valueBytes.length);
		return Buffer.concat([Buffer.from([nameBytes.length]), nameBytes, Buffer.from([7]), valueLength, valueBytes]);
	});
	const headerBytes = Buffer.concat(headers);
	const body = Buffer.from(JSON.stringify(payload));
	const prelude = Buffer.alloc(8);
	prelude.writeUInt32BE(16 + headerBytes.length + body.length);
	prelude.writeUInt32BE(headerBytes.length, 4);
	const preludeChecksum = Buffer.alloc(4);
	preludeChecksum.writeUInt32BE(crc32(prelude));
	const frame = Buffer.concat([prelude, preludeChecksum, headerBytes, body]);
	const frameChecksum = Buffer.alloc(4);
	frameChecksum.writeUInt32BE(crc32(frame));
	return Buffer.concat([frame, frameChecksum]);
}

function reasoningResponse(): Response {
	const events = [
		encodeEvent('messageStart', { role: 'assistant' }),
		...REDACTED_CHUNKS.map((redactedContent) =>
			encodeEvent('contentBlockDelta', {
				contentBlockIndex: 0,
				delta: { reasoningContent: { redactedContent } },
			}),
		),
		encodeEvent('contentBlockStop', { contentBlockIndex: 0 }),
		encodeEvent('contentBlockDelta', { contentBlockIndex: 1, delta: { text: 'OK' } }),
		encodeEvent('contentBlockStop', { contentBlockIndex: 1 }),
		encodeEvent('messageStop', { stopReason: 'end_turn' }),
		encodeEvent('metadata', { usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 } }),
	];
	return new Response(Buffer.concat(events), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } });
}

describe('Bedrock GPT-6 redacted reasoning compatibility', () => {
	it.each(['global.openai.gpt-6-sol', 'global.openai.gpt-6-luna', 'global.openai.gpt-6.1-sol'])(
		'parses chunked redacted reasoning and replays it on a follow-up with %s',
		async (modelId) => {
			const requestBodies: Array<{ messages: Array<{ role: string; content: unknown[] }> }> = [];
			const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				requestBodies.push(JSON.parse(init?.body as string));
				return reasoningResponse();
			});
			const model = createAmazonBedrock({
				region: 'us-east-1',
				apiKey: 'test-key',
				fetch: fetchMock,
			}).languageModel(modelId);
			const result = streamText({ model, prompt: 'Answer OK.', maxRetries: 0, onError() {} });
			const parts = [];
			for await (const part of result.fullStream) {
				parts.push(part);
			}

			expect(parts.filter((part) => part.type === 'error')).toEqual([]);
			expect(await result.text).toBe('OK');
			expect(await result.finishReason).toBe('stop');
			const response = await result.response;
			expect(response.messages).toContainEqual(
				expect.objectContaining({
					role: 'assistant',
					content: expect.arrayContaining([
						expect.objectContaining({
							type: 'reasoning',
							providerOptions: { bedrock: { redactedContent: REDACTED_CONTENT } },
						}),
					]),
				}),
			);

			const followUp = streamText({
				model,
				messages: [
					{ role: 'user', content: 'Answer OK.' },
					...response.messages,
					{ role: 'user', content: 'Again.' },
				],
				maxRetries: 0,
				onError() {},
			});
			const followUpErrors = [];
			for await (const part of followUp.fullStream) {
				if (part.type === 'error') {
					followUpErrors.push(part);
				}
			}
			expect(followUpErrors).toEqual([]);
			expect(await followUp.text).toBe('OK');
			expect(await followUp.finishReason).toBe('stop');
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(requestBodies[1].messages.find((message) => message.role === 'assistant')?.content).toContainEqual({
				reasoningContent: { redactedContent: REDACTED_CONTENT },
			});
		},
	);
});
