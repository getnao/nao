import { streamText, tool } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';

import { createProviderModel } from '../src/agents/providers';

const ANSWER = 'There are 99 orders, up 12% on last month.';

type ThinkingRequest = { thinking?: { type: string; display?: string } };

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('Claude 5.x answer written as a progress update before suggest_follow_ups', () => {
	it.each(['claude-sonnet-5', 'claude-sonnet-5-5', 'claude-opus-5-5'])(
		'shows the answer on the first turn of a new chat with %s',
		async (modelId) => {
			const requests: ThinkingRequest[] = [];
			vi.stubGlobal(
				'fetch',
				vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
					const body = JSON.parse(init?.body as string) as ThinkingRequest;
					requests.push(body);
					return claudeResponse(body.thinking?.display === 'updates' ? ANSWER : '');
				}),
			);

			const { model, providerOptions } = createProviderModel('anthropic', { apiKey: 'test-key' }, modelId);
			const result = streamText({
				model,
				providerOptions,
				prompt: 'How many orders did we get this month?',
				tools: { suggest_follow_ups: tool({ inputSchema: z.object({ suggestions: z.array(z.string()) }) }) },
				maxRetries: 0,
			});

			expect(await result.text).toBe(ANSWER);
			expect(requests[0].thinking).toEqual({ type: 'adaptive', display: 'updates' });
		},
	);
});

/**
 * Streams what Claude 5.x returns when it writes its answer right before calling `suggest_follow_ups`:
 * a signed thinking block (holding the answer only under `display: "updates"`), then the tool call.
 */
function claudeResponse(thinking: string): Response {
	const events = [
		{
			type: 'message_start',
			message: {
				id: 'msg_1',
				type: 'message',
				role: 'assistant',
				model: 'claude',
				content: [],
				stop_reason: null,
				stop_sequence: null,
				usage: { input_tokens: 10, output_tokens: 1 },
			},
		},
		{ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
		{ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } },
		{ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
		{ type: 'content_block_stop', index: 0 },
		{
			type: 'content_block_start',
			index: 1,
			content_block: { type: 'tool_use', id: 'toolu_1', name: 'suggest_follow_ups', input: {} },
		},
		{
			type: 'content_block_delta',
			index: 1,
			delta: { type: 'input_json_delta', partial_json: '{"suggestions":["Break it down by week?"]}' },
		},
		{ type: 'content_block_stop', index: 1 },
		{
			type: 'message_delta',
			delta: { stop_reason: 'tool_use', stop_sequence: null },
			usage: { output_tokens: 20 },
		},
		{ type: 'message_stop' },
	];
	const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
	return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}
