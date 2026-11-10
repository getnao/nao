import { generateText, Output, tool } from 'ai';
import { GoogleAuth } from 'google-auth-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';

import { createProviderModel } from '../src/agents/providers';

type ClaudeRequest = {
	system?: unknown;
	tools?: { name: string }[];
	tool_choice?: { type: string; disable_parallel_tool_use?: boolean };
	output_config?: { format?: unknown };
};

const SCHEMA = z.object({ sql: z.nullable(z.string()) });
const ANSWER = { sql: 'SELECT 1' };
const VERTEX_SETTINGS = { apiKey: '', credentials: { project: 'test-project', location: 'global' } };

let requests: ClaudeRequest[];

beforeEach(() => {
	requests = [];
	vi.spyOn(GoogleAuth.prototype, 'getClient').mockResolvedValue({
		getAccessToken: async () => ({ token: 'test-token' }),
	} as unknown as Awaited<ReturnType<GoogleAuth['getClient']>>);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('Claude on Vertex, models that reject forced tool use', () => {
	it.each(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1'])(
		'%s returns structured output through an unforced json tool',
		async (modelId) => {
			stubClaude(modelId, jsonToolCall);

			const output = await generateStructuredOutput(modelId);

			expect(output).toEqual(ANSWER);
			expect(requests[0].tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
			expect(requests[0].tools?.map((requestTool) => requestTool.name)).toEqual(['json']);
			expect(JSON.stringify(requests[0].system)).toContain('calling the `json` tool');
			expect(requests[0].output_config?.format).toBeUndefined();
		},
	);

	it('still reads the answer when the model writes the JSON as text', async () => {
		stubClaude('claude-opus-5-5', jsonText);

		expect(await generateStructuredOutput('claude-opus-5-5')).toEqual(ANSWER);
	});

	it('asks for a required tool call without forcing it', async () => {
		stubClaude('claude-opus-5-5', jsonText);
		const { model, providerOptions } = createProviderModel('vertex', VERTEX_SETTINGS, 'claude-opus-5-5');

		await generateText({
			model,
			providerOptions,
			toolChoice: 'required',
			tools: { ping: tool({ inputSchema: z.object({}) }) },
			prompt: 'Ping.',
			maxRetries: 0,
		});

		expect(requests[0].tool_choice?.type).toBe('auto');
		expect(JSON.stringify(requests[0].system)).toContain('You must call a tool');
	});
});

describe('Claude on Vertex, models that accept forced tool use', () => {
	it('keeps the forced json tool for claude-sonnet-4-6', async () => {
		stubClaude('claude-sonnet-4-6', jsonToolCall);

		const output = await generateStructuredOutput('claude-sonnet-4-6');

		expect(output).toEqual(ANSWER);
		expect(requests[0].tool_choice?.type).toBe('any');
		expect(requests[0].system).toBeUndefined();
	});
});

async function generateStructuredOutput(modelId: string) {
	const { model, providerOptions } = createProviderModel('vertex', VERTEX_SETTINGS, modelId);
	const result = await generateText({
		model,
		providerOptions,
		output: Output.object({ schema: SCHEMA }),
		prompt: 'How many orders did we get this month?',
		maxRetries: 0,
	});
	return result.output;
}

/** Mimics the Messages API, which answers a forced tool call with a 400 on the newest Claude models. */
function stubClaude(modelId: string, answer: () => object): void {
	const rejectsForcedToolUse = modelId !== 'claude-sonnet-4-6';
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const request = JSON.parse(init?.body as string) as ClaudeRequest;
			requests.push(request);
			const forced = request.tool_choice?.type === 'any' || request.tool_choice?.type === 'tool';
			if (forced && rejectsForcedToolUse) {
				return json(400, {
					type: 'error',
					error: {
						type: 'invalid_request_error',
						message: 'tool_choice: type "tool" and "any" are not supported for this model.',
					},
				});
			}
			return json(200, { id: 'msg_1', type: 'message', role: 'assistant', model: modelId, ...answer() });
		}),
	);
}

function jsonToolCall(): object {
	return {
		content: [
			{ type: 'text', text: 'Here is the query.' },
			{ type: 'tool_use', id: 'toolu_1', name: 'json', input: ANSWER },
		],
		stop_reason: 'tool_use',
		usage: { input_tokens: 10, output_tokens: 5 },
	};
}

function jsonText(): object {
	return {
		content: [{ type: 'text', text: JSON.stringify(ANSWER) }],
		stop_reason: 'end_turn',
		usage: { input_tokens: 10, output_tokens: 5 },
	};
}

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
