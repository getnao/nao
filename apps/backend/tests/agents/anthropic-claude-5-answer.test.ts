import { streamText, tool } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import z from 'zod/v3';

import { createProviderModel } from '../../src/agents/providers';
import { interactiveStopConditions } from '../../src/agents/stop-conditions';
import suggestFollowUps from '../../src/agents/tools/suggest-follow-ups';

const NARRATION = 'Let me count the orders.';
const NOTE = 'There are 99 orders, up 12% on last month, with high confidence.';
const ANSWER = 'There are **99** orders, up 12% on last month.\n\nConfidence: High';
const FOLLOW_UPS_CALL_ID = 'toolu_follow_ups';
const NO_VISIBLE_ANSWER = 'The user has not seen any answer in this turn';
const ESCAPE_HATCH = 'end the turn without repeating it';

type AnthropicContentBlock = { type: string; tool_use_id?: string; content?: unknown };
type AnthropicMessage = { role: string; content: string | AnthropicContentBlock[] };
type AnthropicRequest = { thinking?: { type: string; display?: string }; messages: AnthropicMessage[] };

const countOrders = tool({
	description: 'Count the orders of the current month.',
	inputSchema: z.object({}),
	execute: async () => {
		return { count: 99 };
	},
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('Claude 5.x answer written as a progress update before suggest_follow_ups', () => {
	it.each(['claude-sonnet-5', 'claude-sonnet-5-5', 'claude-opus-5-5'])(
		'asks %s for the visible answer it left in a progress update',
		async (modelId) => {
			const { result, requests } = runAgentTurn(modelId, [noteThenFollowUpsResponse, answerResponse]);

			expect(await result.text).toBe(ANSWER);
			expect(requests).toHaveLength(2);
			expect(requests[0].thinking).toEqual({ type: 'adaptive', display: 'updates' });
			expect(followUpsResultText(requests[1])).toContain(NO_VISIBLE_ANSWER);
		},
	);

	it.each([
		{
			turn: 'no visible text',
			responses: [noteThenFollowUpsResponse, thinkingOnlyResponse],
			expected: NO_VISIBLE_ANSWER,
			unexpected: ESCAPE_HATCH,
		},
		{
			turn: 'visible narration in an earlier step',
			responses: [narrationThenToolResponse, noteThenFollowUpsResponse, thinkingOnlyResponse],
			expected: `<visible_text>\n${NARRATION}\n</visible_text>`,
			unexpected: NO_VISIBLE_ANSWER,
		},
	])('tells the model what the user saw when the turn has $turn', async ({ responses, expected, unexpected }) => {
		const { result, requests } = runAgentTurn('claude-opus-5-5', responses);

		expect(await result.text).toBe('');
		expect(requests).toHaveLength(responses.length);
		const followUpsResult = followUpsResultText(requests.at(-1)!);
		expect(followUpsResult).toContain(expected);
		expect(followUpsResult).not.toContain(unexpected);
	});
});

function runAgentTurn(modelId: string, responses: (() => Response)[]) {
	const requests: AnthropicRequest[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			requests.push(JSON.parse(init?.body as string) as AnthropicRequest);
			return responses[requests.length - 1]();
		}),
	);

	const { model, providerOptions } = createProviderModel('anthropic', { apiKey: 'test-key' }, modelId);
	const result = streamText({
		model,
		providerOptions,
		prompt: 'How many orders did we get this month?',
		tools: { count_orders: countOrders, suggest_follow_ups: suggestFollowUps },
		stopWhen: interactiveStopConditions,
		maxRetries: 0,
	});
	return { result, requests };
}

function followUpsResultText(request: AnthropicRequest): string {
	const toolResult = request.messages
		.flatMap((message) => (typeof message.content === 'string' ? [] : message.content))
		.find((block) => block.type === 'tool_result' && block.tool_use_id === FOLLOW_UPS_CALL_ID);
	const content = toolResult?.content;
	if (typeof content === 'string') {
		return content;
	}
	return ((content ?? []) as { type: string; text?: string }[]).map((block) => block.text ?? '').join('');
}

/** A short remark before a tool call, which Claude 5.x still returns as visible text. */
function narrationThenToolResponse(): Response {
	return sse([
		messageStart(),
		{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
		{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: NARRATION } },
		{ type: 'content_block_stop', index: 0 },
		{
			type: 'content_block_start',
			index: 1,
			content_block: { type: 'tool_use', id: 'toolu_count_orders', name: 'count_orders', input: {} },
		},
		{ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } },
		{ type: 'content_block_stop', index: 1 },
		messageEnd('tool_use'),
		{ type: 'message_stop' },
	]);
}

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
			content_block: { type: 'tool_use', id: FOLLOW_UPS_CALL_ID, name: 'suggest_follow_ups', input: {} },
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

/** What Claude 5.x streams when it ends the turn with reasoning only, leaving the user without an answer. */
function thinkingOnlyResponse(): Response {
	return sse([
		messageStart(),
		{ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
		{ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
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
