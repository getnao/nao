import { createAnthropic } from '@ai-sdk/anthropic';
import { convertToModelMessages, readUIMessageStream, stepCountIs, streamText, type Tool, tool } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';

import { createAdvisorTools } from '../src/agents/tools/advisor';
import type { UIMessage, UIMessagePart } from '../src/types/chat';
import { convertDBPartToUIPart, convertUIPartToDBPart } from '../src/utils/chat-message-part-mappings';
import { stripAdvisorParts } from '../src/utils/model-message';

const ADVICE = 'Check the date filter before blaming churn.';

const SSE_EVENTS = [
	{
		type: 'message_start',
		message: {
			id: 'msg_1',
			type: 'message',
			role: 'assistant',
			model: 'claude-sonnet-5',
			content: [],
			stop_reason: null,
			stop_sequence: null,
			usage: { input_tokens: 10, output_tokens: 1 },
		},
	},
	{
		type: 'content_block_start',
		index: 0,
		content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'advisor', input: {} },
	},
	{ type: 'content_block_stop', index: 0 },
	{
		type: 'content_block_start',
		index: 1,
		content_block: {
			type: 'advisor_tool_result',
			tool_use_id: 'srvtoolu_1',
			content: { type: 'advisor_result', text: ADVICE },
		},
	},
	{ type: 'content_block_stop', index: 1 },
	{ type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
	{ type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Revenue is fine.' } },
	{ type: 'content_block_stop', index: 2 },
	{ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
	{ type: 'message_stop' },
];

const FAILED_ADVISOR_THEN_SQL_EVENTS = [
	SSE_EVENTS[0],
	SSE_EVENTS[1],
	SSE_EVENTS[2],
	{
		type: 'content_block_start',
		index: 1,
		content_block: {
			type: 'advisor_tool_result',
			tool_use_id: 'srvtoolu_1',
			content: { type: 'advisor_tool_result_error', error_code: 'overloaded' },
		},
	},
	{ type: 'content_block_stop', index: 1 },
	{
		type: 'content_block_start',
		index: 2,
		content_block: { type: 'tool_use', id: 'toolu_1', name: 'execute_sql', input: {} },
	},
	{ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"sql":"SELECT 1"}' } },
	{ type: 'content_block_stop', index: 2 },
	{ type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } },
	{ type: 'message_stop' },
];

type CapturedRequest = { body: Record<string, unknown>; beta: string | null };

function createRecordingAnthropic(responses: (typeof SSE_EVENTS)[] = [SSE_EVENTS]) {
	const requests: CapturedRequest[] = [];
	const fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
		const headers = new Headers(init?.headers);
		requests.push({ body: JSON.parse(String(init?.body)), beta: headers.get('anthropic-beta') });
		const events = responses[Math.min(requests.length - 1, responses.length - 1)];
		const sse = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
		return new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
	};
	const model = createAnthropic({ apiKey: 'test-key', fetch }).chat('claude-sonnet-5');
	return { model, requests };
}

const executeSql = tool({
	description: 'Run SQL',
	inputSchema: z.object({ sql: z.string() }),
	execute: async () => ({ rows: [] }),
});

async function runTurn(history: UIMessage[], tools: Record<string, Tool>) {
	const { model, requests } = createRecordingAnthropic();
	const modelMessages = await convertToModelMessages(history, { tools });
	const result = streamText({
		model,
		tools,
		messages: stripAdvisorParts(modelMessages, 'advisor' in tools),
	});
	let message: UIMessage | undefined;
	for await (const snapshot of readUIMessageStream<UIMessage>({ stream: result.toUIMessageStream() })) {
		message = snapshot;
	}
	return { request: requests[0], message: message! };
}

function persistAndReload(message: UIMessage): UIMessage {
	const parts = message.parts
		.map((part, order) => convertUIPartToDBPart(part, 'msg-1', order))
		.filter((part) => part !== undefined)
		.map((part) => convertDBPartToUIPart({ id: 'p', createdAt: new Date(), ...part } as never))
		.filter((part): part is UIMessagePart => part !== undefined);
	return { ...message, parts };
}

const userMessage = (text: string): UIMessage => ({
	id: crypto.randomUUID(),
	role: 'user',
	parts: [{ type: 'text', text }],
});

const advisorTools = { execute_sql: executeSql, ...createAdvisorTools('claude-opus-4-8') } as Record<string, Tool>;

describe('Anthropic advisor tool', () => {
	it('offers the advisor with its beta header and streams its advice as a tool part', async () => {
		const { request, message } = await runTurn([userMessage('Why did revenue drop?')], advisorTools);

		expect(request.beta).toContain('advisor-tool-2026-03-01');
		expect(request.body.tools).toContainEqual({
			type: 'advisor_20260301',
			name: 'advisor',
			model: 'claude-opus-4-8',
		});
		expect(message.parts).toContainEqual(
			expect.objectContaining({
				type: 'tool-advisor',
				toolCallId: 'srvtoolu_1',
				state: 'output-available',
				providerExecuted: true,
				output: { type: 'advisor_result', text: ADVICE },
			}),
		);
	});

	it('replays a stored advisor call verbatim on the next turn', async () => {
		const first = await runTurn([userMessage('Why did revenue drop?')], advisorTools);
		const history = [
			userMessage('Why did revenue drop?'),
			persistAndReload(first.message),
			userMessage('And now?'),
		];

		const { request } = await runTurn(history, advisorTools);

		const assistant = (request.body.messages as { role: string; content: unknown[] }[])[1];
		expect(assistant.role).toBe('assistant');
		expect(assistant.content).toContainEqual(
			expect.objectContaining({ type: 'server_tool_use', id: 'srvtoolu_1', name: 'advisor', input: {} }),
		);
		expect(assistant.content).toContainEqual(
			expect.objectContaining({
				type: 'advisor_tool_result',
				tool_use_id: 'srvtoolu_1',
				content: { type: 'advisor_result', text: ADVICE },
			}),
		);
	});

	it('sends no advisor blocks once the advisor is turned off', async () => {
		const first = await runTurn([userMessage('Why did revenue drop?')], advisorTools);
		const history = [
			userMessage('Why did revenue drop?'),
			persistAndReload(first.message),
			userMessage('And now?'),
		];

		const { request } = await runTurn(history, { execute_sql: executeSql });

		const body = JSON.stringify(request.body);
		expect(request.beta ?? '').not.toContain('advisor');
		expect(body).not.toContain('server_tool_use');
		expect(body).not.toContain('advisor_tool_result');
		expect(body).toContain('Revenue is fine.');
	});

	it('replays a failed advisor call as a valid error block on the next step of the same run', async () => {
		const { model, requests } = createRecordingAnthropic([FAILED_ADVISOR_THEN_SQL_EVENTS, SSE_EVENTS]);

		const result = streamText({
			model,
			tools: advisorTools,
			messages: [{ role: 'user', content: 'Why did revenue drop?' }],
			stopWhen: stepCountIs(2),
		});
		await result.consumeStream();

		expect(requests).toHaveLength(2);
		const assistant = (requests[1].body.messages as { role: string; content: unknown[] }[])[1];
		expect(assistant.content).toContainEqual(
			expect.objectContaining({
				type: 'advisor_tool_result',
				tool_use_id: 'srvtoolu_1',
				content: { type: 'advisor_tool_result_error', error_code: 'overloaded' },
			}),
		);
	});
});
