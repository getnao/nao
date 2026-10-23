import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { generateText, type ModelMessage, Output } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { buildVerificationMessages } from '../src/services/test-agent-verification';
import type { QueryResult } from '../src/types/tools';

const queryResults = new Map<string, QueryResult>([
	[
		'query_revenue',
		{
			columns: ['revenue'],
			data: [{ revenue: 42 }],
		},
	],
]);

const signedReasoning = (text: string) => ({
	type: 'reasoning' as const,
	text,
	providerOptions: { bedrock: { signature: `sig-${text}` } },
});

const responseMessages: ModelMessage[] = [
	{
		role: 'assistant',
		content: [
			signedReasoning('Plan the query'),
			{ type: 'text', text: 'Let me query revenue.' },
			{
				type: 'tool-call',
				toolCallId: 'call-1',
				toolName: 'execute_sql',
				input: { sql_query: 'SELECT 42 AS revenue' },
			},
		],
	},
	{
		role: 'tool',
		content: [
			{
				type: 'tool-result',
				toolCallId: 'call-1',
				toolName: 'execute_sql',
				output: { type: 'text', value: 'Query ID: query_revenue\n| revenue |\n| 42 |' },
			},
		],
	},
	{ role: 'assistant', content: [signedReasoning('Summarise'), { type: 'text', text: 'Revenue is 42.' }] },
];

describe('buildVerificationMessages', () => {
	it('replays the agent response as one text turn between the prompt and the verification request', () => {
		const messages = buildVerificationMessages('What is the revenue?', responseMessages, ['revenue'], queryResults);

		expect(messages).toHaveLength(3);
		expect(messages[0]).toEqual({ role: 'user', content: 'What is the revenue?' });
		expect(messages[1]).toEqual({
			role: 'assistant',
			content: [
				'Let me query revenue.',
				'Tool call execute_sql: {"sql_query":"SELECT 42 AS revenue"}',
				'Tool result execute_sql:\nQuery ID: query_revenue\n| revenue |\n| 42 |',
				'Revenue is 42.',
			].join('\n\n'),
		});
		expect(messages[2]).toMatchObject({
			role: 'user',
			content: expect.stringMatching(
				/For context, the messages above include the original user prompt followed by your analysis and answer.*Return exactly these columns, with these names: revenue/s,
			),
		});
	});

	it('renders non-text tool outputs and truncates long ones', () => {
		const messages = buildVerificationMessages(
			'Q',
			[
				{
					role: 'tool',
					content: [
						{
							type: 'tool-result',
							toolCallId: 'a',
							toolName: 'json_tool',
							output: { type: 'json', value: { n: 1 } },
						},
						{
							type: 'tool-result',
							toolCallId: 'b',
							toolName: 'long_tool',
							output: { type: 'text', value: 'x'.repeat(5000) },
						},
						{
							type: 'tool-result',
							toolCallId: 'c',
							toolName: 'denied_tool',
							output: { type: 'execution-denied' },
						},
					],
				},
			],
			['n'],
			queryResults,
		);

		const transcript = messages[1].content as string;
		expect(transcript).toContain('Tool result json_tool:\n{"n":1}');
		expect(transcript).toContain('Tool result denied_tool:\nexecution-denied');
		expect(transcript.match(/x+\.\.\.x+/)?.[0].length).toBeLessThanOrEqual(2000);
	});

	it('keeps the assistant turn non-empty when the response holds only reasoning', () => {
		const messages = buildVerificationMessages(
			'Q',
			[{ role: 'assistant', content: [signedReasoning('Only thinking')] }],
			['revenue'],
			queryResults,
		);

		expect(messages[1]).toEqual({ role: 'assistant', content: '[No visible response]' });
	});

	it('sends no thinking block to Bedrock for a model that rejects forced tool use', async () => {
		const sentBodies = await captureBedrockBody(
			buildVerificationMessages('What is the revenue?', responseMessages, ['revenue'], queryResults),
		);
		const body = JSON.stringify(sentBodies[0]);

		expect(body).not.toContain('reasoningContent');
		expect(body).toContain('SELECT 42 AS revenue');
	});

	it('control: the verbatim replay does send the signed thinking blocks', async () => {
		const sentBodies = await captureBedrockBody([
			{ role: 'user', content: 'What is the revenue?' },
			...responseMessages,
			{ role: 'user', content: 'Write the query.' },
		]);

		expect(JSON.stringify(sentBodies[0])).toContain('reasoningContent');
	});
});

async function captureBedrockBody(messages: ModelMessage[]): Promise<unknown[]> {
	const bodies: unknown[] = [];
	const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
		bodies.push(JSON.parse(init?.body as string));
		return Response.json({
			output: { message: { role: 'assistant', content: [{ text: '{"sql":"SELECT 1"}' }] } },
			stopReason: 'end_turn',
			usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
		});
	});
	const model = createAmazonBedrock({ region: 'eu-central-1', apiKey: 'test-key', fetch: fetchMock }).languageModel(
		'eu.anthropic.claude-sonnet-5-5',
	);
	await generateText({
		model,
		output: Output.object({ schema: z.object({ sql: z.string().nullable() }) }),
		messages,
		maxRetries: 0,
	});
	return bodies;
}
