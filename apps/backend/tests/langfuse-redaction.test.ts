import type { Attributes } from '@opentelemetry/api';
import type { ReadableSpan, SpanProcessor, TimedEvent } from '@opentelemetry/sdk-trace-node';
import { describe, expect, it, vi } from 'vitest';

import {
	DataToolRedactingSpanProcessor,
	LANGFUSE_REDACTION_PLACEHOLDER,
	redactDataToolAttributes,
} from '../src/utils/langfuse-redaction';

const DISTINCTIVE_SQL = 'SELECT customer_email FROM customers';
const DISTINCTIVE_ROW_VALUE = 'private-customer@example.com';

describe('redactDataToolAttributes', () => {
	it('redacts execute_sql arguments and results while preserving tool identity', () => {
		const attributes: Attributes = {
			'ai.toolCall.name': 'execute_sql',
			'ai.toolCall.id': 'tool-call-1',
			'ai.toolCall.args': JSON.stringify({ query: DISTINCTIVE_SQL }),
			'ai.toolCall.result': JSON.stringify([{ customer_email: DISTINCTIVE_ROW_VALUE }]),
		};

		redactDataToolAttributes(attributes);

		expect(attributes).toEqual({
			'ai.toolCall.name': 'execute_sql',
			'ai.toolCall.id': 'tool-call-1',
			'ai.toolCall.args': LANGFUSE_REDACTION_PLACEHOLDER,
			'ai.toolCall.result': LANGFUSE_REDACTION_PLACEHOLDER,
		});
	});

	it('redacts read_query_result arguments and results while preserving tool identity', () => {
		const attributes: Attributes = {
			'ai.toolCall.name': 'read_query_result',
			'ai.toolCall.id': 'tool-call-2',
			'ai.toolCall.args': JSON.stringify({ queryId: 'query-123' }),
			'ai.toolCall.result': JSON.stringify([{ customer_email: DISTINCTIVE_ROW_VALUE }]),
		};

		redactDataToolAttributes(attributes);

		expect(attributes).toEqual({
			'ai.toolCall.name': 'read_query_result',
			'ai.toolCall.id': 'tool-call-2',
			'ai.toolCall.args': LANGFUSE_REDACTION_PLACEHOLDER,
			'ai.toolCall.result': LANGFUSE_REDACTION_PLACEHOLDER,
		});
	});

	it('leaves non-redacted tool spans untouched', () => {
		const attributes: Attributes = {
			'ai.toolCall.name': 'search',
			'ai.toolCall.id': 'tool-call-3',
			'ai.toolCall.args': JSON.stringify({ query: 'quarterly plan' }),
			'ai.toolCall.result': JSON.stringify({ matches: ['forecast'] }),
		};
		const originalAttributes = structuredClone(attributes);

		redactDataToolAttributes(attributes);

		expect(attributes).toEqual(originalAttributes);
	});

	it('redacts data tool calls and results from message history only', () => {
		const messages = [
			{
				role: 'user',
				content: [{ type: 'text', text: 'Show customer activity' }],
			},
			{
				role: 'assistant',
				content: [
					{
						type: 'tool-call',
						toolCallId: 'sql-call',
						toolName: 'execute_sql',
						input: { query: DISTINCTIVE_SQL },
					},
					{
						type: 'tool-call',
						toolCallId: 'search-call',
						toolName: 'search',
						input: { query: 'customer activity definition' },
					},
				],
			},
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'sql-call',
						toolName: 'execute_sql',
						output: {
							type: 'json',
							value: [{ customer_email: DISTINCTIVE_ROW_VALUE }],
						},
					},
				],
			},
		];
		const responseToolCalls = [
			{
				type: 'tool-call',
				toolCallId: 'response-sql-call',
				toolName: 'execute_sql',
				input: { query: DISTINCTIVE_SQL },
			},
		];
		const attributes: Attributes = {
			'ai.prompt.messages': JSON.stringify(messages),
			'ai.response.toolCalls': JSON.stringify(responseToolCalls),
		};

		redactDataToolAttributes(attributes);

		const sanitizedMessages = JSON.parse(attributes['ai.prompt.messages'] as string) as typeof messages;
		const assistantContent = sanitizedMessages[1]?.content;
		const toolContent = sanitizedMessages[2]?.content;
		expect(sanitizedMessages[0]).toEqual(messages[0]);
		expect(assistantContent?.[0]?.input).toBe(LANGFUSE_REDACTION_PLACEHOLDER);
		expect(assistantContent?.[1]).toEqual(messages[1]?.content[1]);
		expect(toolContent?.[0]?.output).toBe(LANGFUSE_REDACTION_PLACEHOLDER);

		const sanitizedResponseToolCalls = JSON.parse(
			attributes['ai.response.toolCalls'] as string,
		) as typeof responseToolCalls;
		expect(sanitizedResponseToolCalls[0]?.input).toBe(LANGFUSE_REDACTION_PLACEHOLDER);

		const serializedAttributes = JSON.stringify(attributes);
		expect(serializedAttributes).not.toContain(DISTINCTIVE_SQL);
		expect(serializedAttributes).not.toContain(DISTINCTIVE_ROW_VALUE);
		expect(serializedAttributes).toContain('Show customer activity');
		expect(serializedAttributes).toContain('customer activity definition');
	});

	it('redacts older tool payload shapes inside ai.prompt messages', () => {
		const attributes: Attributes = {
			'ai.prompt': JSON.stringify({
				messages: [
					{
						role: 'assistant',
						content: [
							{
								type: 'tool-call',
								toolName: 'read_query_result',
								args: { queryId: 'query-123' },
							},
						],
					},
					{
						role: 'tool',
						content: [
							{
								type: 'tool-result',
								toolName: 'read_query_result',
								result: [{ customer_email: DISTINCTIVE_ROW_VALUE }],
							},
						],
					},
				],
			}),
		};

		redactDataToolAttributes(attributes);

		const prompt = JSON.parse(attributes['ai.prompt'] as string) as {
			messages: Array<{ content: JsonPart[] }>;
		};
		expect(prompt.messages[0]?.content[0]?.args).toBe(LANGFUSE_REDACTION_PLACEHOLDER);
		expect(prompt.messages[1]?.content[0]?.result).toBe(LANGFUSE_REDACTION_PLACEHOLDER);
	});

	it('fails closed for malformed JSON that names a redacted tool', () => {
		const attributes: Attributes = {
			'ai.prompt.messages': `{"toolName":"execute_sql","input":{"query":"${DISTINCTIVE_SQL}"}`,
		};

		redactDataToolAttributes(attributes);

		expect(attributes['ai.prompt.messages']).toBe(LANGFUSE_REDACTION_PLACEHOLDER);
	});

	it('leaves malformed JSON alone when no redacted tool is named', () => {
		const rawMessages = '{"toolName":"search","input":';
		const attributes: Attributes = {
			'ai.prompt.messages': rawMessages,
		};

		redactDataToolAttributes(attributes);

		expect(attributes['ai.prompt.messages']).toBe(rawMessages);
	});
});

describe('DataToolRedactingSpanProcessor', () => {
	it('scrubs exception details on redacted tool spans', () => {
		const attributes: Attributes = {
			'ai.toolCall.name': 'execute_sql',
		};
		const events: TimedEvent[] = [
			{
				name: 'exception',
				time: [0, 0],
				attributes: {
					'exception.type': 'DatabaseError',
					'exception.message': `Query failed: ${DISTINCTIVE_SQL}`,
					'exception.stacktrace': `DatabaseError: ${DISTINCTIVE_ROW_VALUE}`,
				},
			},
			{
				name: 'event-without-attributes',
				time: [0, 0],
			},
		];

		runSpanThroughProcessor(attributes, events);

		expect(events[0]?.attributes).toEqual({
			'exception.type': 'DatabaseError',
			'exception.message': LANGFUSE_REDACTION_PLACEHOLDER,
			'exception.stacktrace': LANGFUSE_REDACTION_PLACEHOLDER,
		});
	});

	it('preserves exception details on normal tool spans', () => {
		const attributes: Attributes = {
			'ai.toolCall.name': 'search',
		};
		const events: TimedEvent[] = [
			{
				name: 'exception',
				time: [0, 0],
				attributes: {
					'exception.message': 'Search service unavailable',
					'exception.stacktrace': 'SearchError: unavailable',
				},
			},
		];
		const originalEvents = structuredClone(events);

		runSpanThroughProcessor(attributes, events);

		expect(events).toEqual(originalEvents);
	});
});

interface JsonPart {
	input?: unknown;
	args?: unknown;
	output?: unknown;
	result?: unknown;
}

function runSpanThroughProcessor(attributes: Attributes, events: TimedEvent[]): void {
	const delegate: SpanProcessor = {
		onStart: vi.fn(),
		onEnd: vi.fn(),
		forceFlush: vi.fn().mockResolvedValue(undefined),
		shutdown: vi.fn().mockResolvedValue(undefined),
	};
	const processor = new DataToolRedactingSpanProcessor(delegate);
	const span = { attributes, events } as unknown as ReadableSpan;

	processor.onEnd(span);

	expect(delegate.onEnd).toHaveBeenCalledWith(span);
}
