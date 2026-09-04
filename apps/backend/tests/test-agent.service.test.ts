import { LLM_PROVIDERS, type LlmProvider } from '@nao/shared/types';
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

const nonGoogleProviders = [
	...LLM_PROVIDERS.filter((provider) => provider !== 'google'),
	'openaiCompatible/custom',
] satisfies LlmProvider[];

describe('buildVerificationMessages', () => {
	it('restores the original user turn for Google', () => {
		const messages = buildVerificationMessages(
			'google',
			'What is the revenue?',
			responseMessages,
			['revenue'],
			queryResults,
		);

		expect(messages.slice(0, -1)).toEqual([{ role: 'user', content: 'What is the revenue?' }, ...responseMessages]);
		expect(messages.at(-1)).toMatchObject({
			role: 'user',
			content: expect.stringContaining('Return exactly these columns, with these names: revenue'),
		});
	});

	it.each(nonGoogleProviders)('keeps the existing message sequence for %s', (provider) => {
		const messages = buildVerificationMessages(
			provider,
			'What is the revenue?',
			responseMessages,
			['revenue'],
			queryResults,
		);

		expect(messages.slice(0, -1)).toEqual(responseMessages);
		expect(messages).toHaveLength(responseMessages.length + 1);
		expect(messages.at(-1)).toMatchObject({ role: 'user' });
	});
});
