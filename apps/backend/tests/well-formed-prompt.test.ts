import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider';
import { generateText, type ModelMessage } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProviderModel } from '../src/agents/providers';
import { withWellFormedPrompt } from '../src/agents/well-formed-prompt';

const LONE_HIGH = 'before \uD83D after';
const LONE_LOW = 'before \uDE00 after';

const HISTORY: ModelMessage[] = [
	{ role: 'user', content: 'Show me the latest tickets' },
	{
		role: 'assistant',
		content: [
			{ type: 'text', text: LONE_HIGH },
			{ type: 'tool-call', toolCallId: 'call_1', toolName: 'execute_sql', input: { sql: 'select 1' } },
		],
	},
	{
		role: 'tool',
		content: [
			{
				type: 'tool-result',
				toolCallId: 'call_1',
				toolName: 'execute_sql',
				output: { type: 'text', value: `${LONE_LOW} 😀` },
			},
		],
	},
	{ role: 'user', content: 'Thanks, and for last week?' },
];

describe('withWellFormedPrompt', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('sends a request body without lone surrogates for a provider model', async () => {
		const body = await captureRequestBody();

		expect(findMalformedStrings(body)).toEqual([]);
		expect(body).toContain('"output":"before \uFFFD after 😀"');
	});

	it('replaces lone surrogates with U+FFFD and keeps valid pairs', async () => {
		const prompt = await promptReceivedBy(HISTORY, 'system \uDE00');

		expect(prompt[0]).toEqual({ role: 'system', content: 'system \uFFFD' });
		expect(JSON.stringify(prompt)).toContain('before \uFFFD after 😀');
		expect(JSON.stringify(prompt)).not.toMatch(/\\ud[89a-f]/i);
	});

	it('leaves binary file data untouched', async () => {
		const data = new Uint8Array([1, 2, 3]);
		const prompt = await promptReceivedBy([
			{ role: 'user', content: [{ type: 'file', data, mediaType: 'image/png' }] },
		]);

		const [message] = prompt;
		expect(message.role === 'user' && message.content[0]).toMatchObject({ type: 'file', data });
	});
});

async function captureRequestBody(): Promise<string> {
	let body = '';
	vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
		body = String(init.body);
		throw new Error('request captured');
	});
	const { model } = createProviderModel(
		'openai',
		{ apiKey: 'test-key', baseURL: 'http://litellm.test/v1' },
		'gpt-5.5',
	);

	await expect(generateText({ model, system: 'system \uDE00', messages: HISTORY, maxRetries: 0 })).rejects.toThrow();
	return body;
}

function findMalformedStrings(json: string): string[] {
	const malformed: string[] = [];
	JSON.parse(json, (_key, value) => {
		if (typeof value === 'string' && !value.isWellFormed()) {
			malformed.push(value);
		}
		return value;
	});
	return malformed;
}

async function promptReceivedBy(
	messages: ModelMessage[],
	system?: string,
): Promise<LanguageModelV3CallOptions['prompt']> {
	let received: LanguageModelV3CallOptions['prompt'] = [];
	const model = withWellFormedPrompt(fakeModel((options) => (received = options.prompt)));

	await generateText({ model, system, messages });
	return received;
}

function fakeModel(onCall: (options: LanguageModelV3CallOptions) => void): LanguageModelV3 {
	return {
		specificationVersion: 'v3',
		provider: 'fake',
		modelId: 'fake',
		supportedUrls: {},
		doGenerate: async (options) => {
			onCall(options);
			return {
				content: [{ type: 'text', text: 'ok' }],
				finishReason: { unified: 'stop', raw: undefined },
				usage: {
					inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
					outputTokens: { total: 1, text: 1, reasoning: 0 },
				},
				warnings: [],
			};
		},
		doStream: async () => {
			throw new Error('not used');
		},
	};
}
