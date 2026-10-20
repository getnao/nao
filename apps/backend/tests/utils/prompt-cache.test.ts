import type { LlmSelectedModel } from '@nao/shared/types';
import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import { addPromptCache, cachedSystemInstructions, getPromptCacheProvider } from '../../src/utils/prompt-cache';

describe('cachedSystemInstructions', () => {
	it('returns plain instructions for providers without prompt caching', () => {
		expect(cachedSystemInstructions('System prompt', modelSelection('openai', 'gpt-5.2'))).toBe('System prompt');
	});

	it('adds a one-hour Anthropic cache breakpoint', () => {
		expect(cachedSystemInstructions('System prompt', modelSelection('anthropic', 'claude-sonnet-4.5'))).toEqual({
			role: 'system',
			content: 'System prompt',
			providerOptions: {
				anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } },
			},
		});
	});
});

describe('addPromptCache', () => {
	const messages: ModelMessage[] = [
		{ role: 'system', content: 'System prompt' },
		{ role: 'user', content: 'Question' },
	];

	it.each([
		['direct Anthropic models', modelSelection('anthropic', 'claude-sonnet-4.5')],
		['Vertex Claude models', modelSelection('vertex', 'claude-sonnet-4.5')],
		['OpenRouter Claude models', modelSelection('openrouter', 'anthropic/claude-haiku-4.5')],
	])('uses Anthropic cache control for %s', (_name, model) => {
		const cached = addPromptCache(messages, model);

		expect(cached[0].providerOptions).toEqual({
			anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } },
		});
		expect(cached[1].providerOptions).toEqual({
			anthropic: { cacheControl: { type: 'ephemeral' } },
		});
	});

	it('does not cache OpenRouter models that cache server-side', () => {
		expect(addPromptCache(messages, modelSelection('openrouter', 'openai/gpt-5.2'))).toBe(messages);
	});

	it('uses Bedrock cache points for Bedrock Anthropic foundation models', () => {
		const cached = addPromptCache(messages, modelSelection('bedrock', 'us.anthropic.claude-sonnet-4-6'));

		expect(cached[0].providerOptions).toEqual({
			bedrock: { cachePoint: { type: 'default', ttl: '1h' } },
		});
		expect(cached[1].providerOptions).toEqual({
			bedrock: { cachePoint: { type: 'default' } },
		});
	});

	it.each([
		[
			'Anthropic inference profile ARNs',
			'arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-sonnet-4-6',
		],
		[
			'custom profile ARNs that identify Claude',
			'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/analytics-claude-prod',
		],
	])('uses Bedrock cache points for %s', (_name, modelId) => {
		expect(getPromptCacheProvider(modelSelection('bedrock', modelId))).toBe('bedrock');
	});

	it('does not cache Bedrock models that are not identifiable as Anthropic', () => {
		const modelId = 'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/analytics-prod';

		expect(addPromptCache(messages, modelSelection('bedrock', modelId))).toBe(messages);
	});
});

function modelSelection(provider: LlmSelectedModel['provider'], modelId: string): LlmSelectedModel {
	return { provider, modelId };
}
