import type { LlmSelectedModel } from '@nao/shared/types';
import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import { addPromptCache, getPromptCacheProvider } from '../src/utils/prompt-cache';

describe('addPromptCache', () => {
	const messages: ModelMessage[] = [
		{ role: 'system', content: 'System prompt' },
		{ role: 'user', content: 'Question' },
	];

	it('uses Anthropic cache control for direct Anthropic models', () => {
		const cached = addPromptCache(messages, modelSelection('anthropic', 'claude-sonnet-4.5'));

		expect(cached[0].providerOptions).toEqual({
			anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } },
		});
		expect(cached[1].providerOptions).toEqual({
			anthropic: { cacheControl: { type: 'ephemeral' } },
		});
	});

	it('uses Anthropic cache control for Vertex Claude models', () => {
		const cached = addPromptCache(messages, modelSelection('vertex', 'claude-sonnet-4.5'));

		expect(cached[0].providerOptions).toEqual({
			anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } },
		});
		expect(cached[1].providerOptions).toEqual({
			anthropic: { cacheControl: { type: 'ephemeral' } },
		});
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

	it('uses Bedrock cache points for Anthropic inference profile ARNs', () => {
		const modelId = 'arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-sonnet-4-6';

		expect(getPromptCacheProvider(modelSelection('bedrock', modelId))).toBe('bedrock');
	});

	it('uses Bedrock cache points for custom profile ARNs that identify Claude', () => {
		const modelId = 'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/analytics-claude-prod';

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
