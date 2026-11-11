import { streamText } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProviderModel } from '../src/agents/providers';
import { interactiveStopConditions } from '../src/agents/stop-conditions';
import suggestFollowUps from '../src/agents/tools/suggest-follow-ups';

const NOTE = 'There are 99 orders, up 12% on last month, with high confidence.';
const ANSWER = 'There are **99** orders, up 12% on last month.\n\nConfidence: High';

type AnthropicRequest = { thinking?: { type: string; display?: string }; messages: unknown[] };

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('Claude 5.x answer written as a progress update before suggest_follow_ups', () => {
	it.each(['claude-sonnet-5', 'claude-sonnet-5-5', 'claude-opus-5-5'])(
		'asks %s for the visible answer it left in a progress update',
		async (modelId) => {
			const requests: AnthropicRequest[] = [];
			vi.stubGlobal(
				'fetch',
				vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
					requests.push(JSON.parse(init?.body as string) as AnthropicRequest);
					return requests.length === 1 ? noteThenFollowUpsResponse() : answerResponse();
				}),
			);

			const { model, providerOptions } = createProviderModel('anthropic', { apiKey: 'test-key' }, modelId);
			const result = streamText({
				model,
				providerOptions,
				prompt: 'How many orders did we get this month?',
				tools: { suggest_follow_ups: suggestFollowUps },
				stopWhen: interactiveStopConditions,
				maxRetries: 0,
			});

			expect(await result.text).toBe(ANSWER);
			expect(requests).toHaveLength(2);
			expect(requests[0].thinking).toEqual({ type: 'adaptive', display: 'updates' });
			expect(JSON.stringify(requests[1].messages)).toContain('this response carried no visible answer');
		},
	);
});

/** What Claude 5.x streams when it writes its answer as a note right before calling `suggest_follow_ups`. */
function noteThenFollowUpsResponse(): Response {
	return sse([
		messageStart(),
		{ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
		{ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: NOTE } },
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
		messageEnd('tool_use'),
		{ type: 'message_stop' },
	]);
}

function answerResponse(): Response {
	return sse([
		messageStart(),
		{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
		{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ANSWER } },
		{ type: 'content_block_stop', index: 0 },
		messageEnd('end_turn'),
		{ type: 'message_stop' },
	]);
}

function messageStart() {
	return {
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
	};
}

function messageEnd(stopReason: string) {
	return {
		type: 'message_delta',
		delta: { stop_reason: stopReason, stop_sequence: null },
		usage: { output_tokens: 20 },
	};
}

function sse(events: { type: string }[]): Response {
	const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
	return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}
