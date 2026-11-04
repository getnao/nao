import { describe, expect, it } from 'vitest';

import {
	isLlmProvider,
	isSameModel,
	providerKind,
	providerLabel,
	providerName,
	resultModel,
	toNamedProvider,
	toProviderName,
} from '../src/types';

describe('provider ids', () => {
	it('reads the kind and the name of a named provider', () => {
		expect(providerKind('openaiCompatible/my-vllm')).toBe('openaiCompatible');
		expect(providerName('openaiCompatible/my-vllm')).toBe('my-vllm');
		expect(providerLabel('openaiCompatible/my-vllm')).toBe('my-vllm');
	});

	it('reads a built-in provider as its own kind, under no name', () => {
		expect(providerKind('anthropic')).toBe('anthropic');
		expect(providerName('anthropic')).toBeNull();
		expect(providerLabel('anthropic')).toBe('Anthropic');
	});

	it('turns what an admin types into a name the app can address', () => {
		expect(toProviderName(' My vLLM ')).toBe('my-vllm');
		expect(toNamedProvider('my-vllm')).toBe('openaiCompatible/my-vllm');
		expect(toProviderName('***')).toBeNull();
	});

	it('accepts only kinds and named instances of the kind that allows them', () => {
		expect(isLlmProvider('nao')).toBe(true);
		expect(isLlmProvider('openai')).toBe(true);
		expect(isLlmProvider('openaiCompatible/my-vllm')).toBe(true);
		expect(isLlmProvider('openaiCompatible/My vLLM')).toBe(false);
		expect(isLlmProvider('openaiCompatible/a/b')).toBe(false);
		expect(isLlmProvider('openai/my-proxy')).toBe(false);
		expect(isLlmProvider('not-a-provider')).toBe(false);
	});
});

describe('selected models', () => {
	it('matches models on both their provider and their id', () => {
		const model = { provider: 'anthropic' as const, modelId: 'claude-sonnet-4-5' };
		expect(isSameModel(model, { ...model })).toBe(true);
		expect(isSameModel(model, { provider: 'openai', modelId: 'claude-sonnet-4-5' })).toBe(false);
	});

	it('reads the model of a stored result', () => {
		expect(resultModel({ llmProvider: 'openai', llmModelId: 'gpt-4.1' })).toEqual({
			provider: 'openai',
			modelId: 'gpt-4.1',
		});
	});
});
