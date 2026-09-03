import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';

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

describe('buildVerificationMessages', () => {
	it('restores the original user turn before tool-call response messages', () => {
		const responseMessages: ModelMessage[] = [
			{
				role: 'assistant',
				content: [
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
						output: { type: 'json', value: { data: [{ revenue: 42 }] } },
					},
				],
			},
			{ role: 'assistant', content: 'Revenue is 42.' },
		];

		const messages = buildVerificationMessages('What is the revenue?', responseMessages, ['revenue'], queryResults);

		expect(messages.slice(0, -1)).toEqual([{ role: 'user', content: 'What is the revenue?' }, ...responseMessages]);
		expect(messages.at(-1)).toMatchObject({
			role: 'user',
			content: expect.stringContaining('Return exactly these columns, with these names: revenue'),
		});
	});

	it('keeps text-only response messages between the original and verification user turns', () => {
		const responseMessages: ModelMessage[] = [{ role: 'assistant', content: 'Revenue is 42.' }];

		const messages = buildVerificationMessages('What is the revenue?', responseMessages, ['revenue'], queryResults);

		expect(messages).toHaveLength(3);
		expect(messages[0]).toEqual({ role: 'user', content: 'What is the revenue?' });
		expect(messages[1]).toEqual(responseMessages[0]);
		expect(messages[2]).toMatchObject({ role: 'user' });
	});
});
