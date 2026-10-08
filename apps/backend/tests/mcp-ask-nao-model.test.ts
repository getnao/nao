import { describe, expect, it } from 'vitest';

import { pickRequestedModel, type ProjectAvailableModel, RequestedModelError } from '../src/utils/llm';

const available: ProjectAvailableModel[] = [
	{ provider: 'mistral', modelId: 'mistral-medium-latest', name: 'Mistral Medium', baseUrl: null },
	{ provider: 'mistral', modelId: 'mistral-large-4', name: 'Mistral Large 4', baseUrl: null },
	{ provider: 'anthropic', modelId: 'claude-opus-5-5', name: 'Claude Opus 5.5', baseUrl: null },
	{ provider: 'openai', modelId: 'shared-id', name: 'Shared (OpenAI)', baseUrl: null },
	{ provider: 'custom', modelId: 'shared-id', name: 'Shared (custom)', baseUrl: 'https://llm.example' },
	{ provider: 'openrouter', modelId: 'mistralai/mistral-large', name: 'Mistral Large (OpenRouter)', baseUrl: null },
];

describe('pickRequestedModel', () => {
	it('matches a bare model id regardless of case', () => {
		expect(pickRequestedModel(available, 'Mistral-Large-4')).toEqual({
			provider: 'mistral',
			modelId: 'mistral-large-4',
		});
	});

	it('matches the display name', () => {
		expect(pickRequestedModel(available, 'claude opus 5.5')).toEqual({
			provider: 'anthropic',
			modelId: 'claude-opus-5-5',
		});
	});

	it('accepts a provider-qualified id when several providers serve the same id', () => {
		expect(pickRequestedModel(available, 'custom/shared-id')).toEqual({ provider: 'custom', modelId: 'shared-id' });
	});

	it('refuses an ambiguous bare id and lists the qualified candidates', () => {
		expect(() => pickRequestedModel(available, 'shared-id')).toThrow(RequestedModelError);
		expect(() => pickRequestedModel(available, 'shared-id')).toThrow('openai/shared-id, custom/shared-id');
	});

	it('prefers an exact id containing a slash over the provider/model split', () => {
		expect(pickRequestedModel(available, 'mistralai/mistral-large')).toEqual({
			provider: 'openrouter',
			modelId: 'mistralai/mistral-large',
		});
	});

	it('rejects unknown and empty models with the list of available ones', () => {
		expect(() => pickRequestedModel(available, 'gpt-99')).toThrow(
			'Unknown model "gpt-99". Available models: mistral/',
		);
		expect(() => pickRequestedModel(available, '  ')).toThrow('`model` must not be empty.');
	});
});
