import { describe, expect, it } from 'vitest';

import {
	isLlmProvider,
	providerKind,
	providerLabel,
	providerName,
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
		expect(isLlmProvider('openai')).toBe(true);
		expect(isLlmProvider('openaiCompatible/my-vllm')).toBe(true);
		expect(isLlmProvider('openaiCompatible/My vLLM')).toBe(false);
		expect(isLlmProvider('openaiCompatible/a/b')).toBe(false);
		expect(isLlmProvider('openai/my-proxy')).toBe(false);
		expect(isLlmProvider('not-a-provider')).toBe(false);
	});
});
