import { generateText, Output, tool } from 'ai';
import { GoogleAuth } from 'google-auth-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';

import { createProviderModel } from '../src/agents/providers';

type ClaudeRequest = {
	tools?: { name: string }[];
	tool_choice?: { type: string; disable_parallel_tool_use?: boolean };
};

const ANSWER = { sql: 'SELECT 1' };
const VERTEX_SETTINGS = { apiKey: '', credentials: { project: 'test-project', location: 'global' } };

let requests: ClaudeRequest[];

beforeEach(() => {
	requests = [];
	vi.spyOn(GoogleAuth.prototype, 'getClient').mockResolvedValue({
		getAccessToken: async () => ({ token: 'test-token' }),
	} as unknown as Awaited<ReturnType<GoogleAuth['getClient']>>);
	vi.stubGlobal('fetch', vi.fn(claudeRejectingForcedToolUse));
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('Claude on Vertex never gets a forced tool call', () => {
	it.each(['claude-opus-5-5', 'claude-sonnet-4-6'])('%s returns structured output', async (modelId) => {
		const { model, providerOptions } = createProviderModel('vertex', VERTEX_SETTINGS, modelId);

		const result = await generateText({
			model,
			providerOptions,
			output: Output.object({ schema: z.object({ sql: z.nullable(z.string()) }) }),
			prompt: 'How many orders did we get this month?',
			maxRetries: 0,
		});

		expect(result.output).toEqual(ANSWER);
		expect(requests[0].tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
		expect(requests[0].tools?.map((requestTool) => requestTool.name)).toEqual(['json']);
	});

	it('asks for a required tool call without forcing it', async () => {
		const { model, providerOptions } = createProviderModel('vertex', VERTEX_SETTINGS, 'claude-opus-5-5');

		const result = await generateText({
			model,
			providerOptions,
			toolChoice: 'required',
			tools: { json: tool({ inputSchema: z.object({ sql: z.string() }) }) },
			prompt: 'Write the query.',
			maxRetries: 0,
		});

		expect(result.toolCalls).toHaveLength(1);
		expect(requests[0].tool_choice?.type).toBe('auto');
	});
});

/** Mimics the Messages API of the newest Claude models, which answer a forced tool call with a 400. */
async function claudeRejectingForcedToolUse(_input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const request = JSON.parse(init?.body as string) as ClaudeRequest;
	requests.push(request);
	if (request.tool_choice?.type === 'any' || request.tool_choice?.type === 'tool') {
		return json(400, {
			type: 'error',
			error: {
				type: 'invalid_request_error',
				message: 'tool_choice: type "tool" and "any" are not supported for this model.',
			},
		});
	}
	return json(200, {
		id: 'msg_1',
		type: 'message',
		role: 'assistant',
		model: 'claude',
		content: [{ type: 'tool_use', id: 'toolu_1', name: 'json', input: ANSWER }],
		stop_reason: 'tool_use',
		usage: { input_tokens: 10, output_tokens: 5 },
	});
}

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
