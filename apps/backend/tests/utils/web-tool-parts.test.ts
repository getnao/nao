import { describe, expect, it } from 'vitest';

import type { UIMessage, UIMessagePart } from '../../src/types/chat';
import { replaceForeignWebToolParts } from '../../src/utils/web-tool-parts';

const openaiWebSearchPart = {
	type: 'tool-web_search',
	toolCallId: 'ws_123',
	state: 'output-available',
	input: {},
	output: {
		action: { type: 'search', query: 'getnao nao GitHub' },
		sources: [
			{ url: 'https://github.com/getnao/nao', type: 'url' },
			{ url: 'https://github.com/getnao', type: 'url' },
		],
	},
	providerExecuted: true,
} as unknown as UIMessagePart;

const anthropicWebSearchPart = {
	type: 'tool-web_search',
	toolCallId: 'srvtoolu_123',
	state: 'output-available',
	input: { query: 'nao analytics agent' },
	output: [
		{ url: 'https://getnao.io', title: 'nao', encryptedContent: 'abc', type: 'web_search_result' },
		{ url: 'https://docs.getnao.io', title: 'docs', encryptedContent: 'def', type: 'web_search_result' },
	],
	providerExecuted: true,
} as unknown as UIMessagePart;

const textPart: UIMessagePart = { type: 'text', text: 'nao is on GitHub.' };

function assistantMessage(parts: UIMessagePart[], llmProvider?: UIMessage['llmProvider']): UIMessage {
	return { id: 'assistant', role: 'assistant', parts, llmProvider };
}

describe('replaceForeignWebToolParts', () => {
	it('turns an OpenAI web search into a text trace when the chat moves to Anthropic', () => {
		const [message] = replaceForeignWebToolParts(
			[assistantMessage([openaiWebSearchPart, textPart], 'openai')],
			'anthropic',
		);

		expect(message.parts).toHaveLength(2);
		expect(message.parts[0]).toEqual({
			type: 'text',
			text: [
				'[web_search run by a previous model]',
				'Query: getnao nao GitHub',
				'Url: https://github.com/getnao/nao, https://github.com/getnao',
			].join('\n'),
		});
		expect(message.parts[1]).toBe(textPart);
	});

	it('turns an Anthropic web search into a text trace when the chat moves to OpenAI', () => {
		const [message] = replaceForeignWebToolParts(
			[assistantMessage([anthropicWebSearchPart], 'anthropic')],
			'openai',
		);

		expect(message.parts[0]).toEqual({
			type: 'text',
			text: [
				'[web_search run by a previous model]',
				'Query: nao analytics agent',
				'Url: https://getnao.io, https://docs.getnao.io',
			].join('\n'),
		});
	});

	it('keeps web tool parts produced by the current provider', () => {
		const original = assistantMessage([openaiWebSearchPart], 'openai');
		const [message] = replaceForeignWebToolParts([original], 'openai');

		expect(message).toBe(original);
	});

	it('keeps messages whose provider is unknown', () => {
		const original = assistantMessage([openaiWebSearchPart]);
		const [message] = replaceForeignWebToolParts([original], 'anthropic');

		expect(message).toBe(original);
	});

	it('leaves other tool parts and user messages untouched', () => {
		const sqlPart = {
			type: 'tool-execute_sql',
			toolCallId: 'call_1',
			state: 'output-available',
			input: { sql_query: 'select 1' },
			output: { rows: [] },
		} as unknown as UIMessagePart;
		const userMessage: UIMessage = { id: 'user', role: 'user', parts: [{ type: 'text', text: 'hi' }] };
		const original = assistantMessage([sqlPart], 'openai');

		const [user, assistant] = replaceForeignWebToolParts([userMessage, original], 'anthropic');

		expect(user).toBe(userMessage);
		expect(assistant).toBe(original);
	});
});
