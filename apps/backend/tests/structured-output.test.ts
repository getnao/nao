import type { LlmProvider } from '@nao/shared/types';
import { generateText, Output } from 'ai';
import { GoogleAuth } from 'google-auth-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';

import { createProviderModel } from '../src/agents/providers';
import type { ProviderSettings } from '../src/types/llm';

type ClaudeRequest = {
	tools?: unknown[];
	tool_choice?: { type: string };
	output_config?: { format?: { type: string } };
};

const SCHEMA = z.object({ sql: z.nullable(z.string()) });

const PROVIDER_SETTINGS: Partial<Record<LlmProvider, ProviderSettings>> = {
	anthropic: { apiKey: 'test-key' },
	vertex: { apiKey: '', credentials: { project: 'test-project', location: 'global' } },
};

beforeEach(() => {
	vi.spyOn(GoogleAuth.prototype, 'getClient').mockResolvedValue({
		getAccessToken: async () => ({ token: 'test-token' }),
	} as unknown as Awaited<ReturnType<GoogleAuth['getClient']>>);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('Output.object on Claude models that reject forced tool use', () => {
	it.each<[LlmProvider, string]>([
		['vertex', 'claude-opus-5-5'],
		['vertex', 'claude-sonnet-5-5'],
		['anthropic', 'claude-opus-5-5'],
		['anthropic', 'claude-fable-5-1'],
	])('%s %s answers through output_config.format', async (provider, modelId) => {
		const { output, request } = await generateStructuredOutput(provider, modelId);

		expect(output).toEqual({ sql: 'SELECT 1' });
		expect(request.output_config?.format?.type).toBe('json_schema');
		expect(request.tool_choice).toBeUndefined();
	});

	it.each(['claude-sonnet-4-20250514', 'claude-opus-4-0', 'claude-3-7-sonnet-latest'])(
		'keeps the SDK default for %s, released before native structured outputs',
		(modelId) => {
			const { providerOptions } = createProviderModel('anthropic', { apiKey: 'test-key' }, modelId);

			expect(providerOptions.anthropic).not.toHaveProperty('structuredOutputMode');
		},
	);
});

async function generateStructuredOutput(provider: LlmProvider, modelId: string) {
	const requests: ClaudeRequest[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const request = JSON.parse(init?.body as string) as ClaudeRequest;
			requests.push(request);
			return claudeResponse(request, modelId);
		}),
	);

	const { model, providerOptions } = createProviderModel(provider, PROVIDER_SETTINGS[provider]!, modelId);
	const result = await generateText({
		model,
		providerOptions,
		output: Output.object({ schema: SCHEMA }),
		prompt: 'How many orders did we get this month?',
		maxRetries: 0,
	});

	return { output: result.output, request: requests[0] };
}

/** Mimics the Messages API for Claude Opus 5.5 / Sonnet 5.5 / Fable 5.1, which 400 on forced tool use. */
function claudeResponse(request: ClaudeRequest, modelId: string): Response {
	const forcedToolChoice = request.tool_choice?.type === 'any' || request.tool_choice?.type === 'tool';
	if (forcedToolChoice) {
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
		model: modelId,
		content: [{ type: 'text', text: '{"sql":"SELECT 1"}' }],
		stop_reason: 'end_turn',
		stop_sequence: null,
		usage: { input_tokens: 10, output_tokens: 5 },
	});
}

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
