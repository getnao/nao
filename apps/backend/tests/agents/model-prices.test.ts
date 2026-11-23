import type { LlmProviderKind } from '@nao/shared/types';
import { describe, expect, it } from 'vitest';

import { getBuiltInModelPrices, resolveModelPrices } from '../../src/agents/model-prices';
import { PROVIDER_META } from '../../src/agents/provider-meta';

const MODELS_DEV_UNLISTED = [
	'mistral/labs-leanstral-2603',
	'requesty/openai/gpt-4o-mini',
	'requesty/deepseek/deepseek-chat',
	'ollama/qwen3:8b',
	'ollama/llama3.2:3b',
	'ollama/mistral:7b',
	'moonshot/kimi-k2.5',
];

describe('getBuiltInModelPrices', () => {
	it('prices every catalogue model that models.dev lists', () => {
		const unpriced = Object.entries(PROVIDER_META).flatMap(([kind, meta]) =>
			meta.models
				.filter((model) => !getBuiltInModelPrices(kind as LlmProviderKind, model.id))
				.map((model) => `${kind}/${model.id}`),
		);

		expect(unpriced).toEqual(MODELS_DEV_UNLISTED);
	});

	it('keeps the regional price of a listed Bedrock geo id', () => {
		const regional = getBuiltInModelPrices('bedrock', 'eu.anthropic.claude-sonnet-5-5');
		const global = getBuiltInModelPrices('bedrock', 'global.anthropic.claude-sonnet-5-5');

		expect(regional?.inputNoCache).toBeGreaterThan(global?.inputNoCache ?? Infinity);
	});

	it.each(['apac', 'us-gov'])('gives an unlisted %s. geo id the prices of its us. twin', (geo) => {
		const twin = getBuiltInModelPrices('bedrock', 'us.anthropic.claude-sonnet-5-5');

		expect(twin).toBeDefined();
		expect(getBuiltInModelPrices('bedrock', `${geo}.anthropic.claude-sonnet-5-5`)).toEqual(twin);
	});

	it.each([
		{ provider: 'vertex', modelId: 'claude-sonnet-4-6', listedAs: ['vertex', 'claude-sonnet-4-6@default'] },
		{ provider: 'requesty', modelId: 'anthropic/claude-sonnet-4-5', listedAs: ['requesty', 'claude-sonnet-4-5'] },
		{ provider: 'requesty', modelId: 'moonshotai/kimi-k3.1-pro', listedAs: ['requesty', 'kimi-k3.1-pro'] },
		{ provider: 'nao', modelId: 'gpt-6-luna', listedAs: ['openai', 'gpt-6-luna'] },
		{
			provider: 'bedrock/eu-prod',
			modelId: 'eu.anthropic.claude-sonnet-5-5',
			listedAs: ['bedrock', 'eu.anthropic.claude-sonnet-5-5'],
		},
	] as const)('prices $provider $modelId as models.dev lists $listedAs', ({ provider, modelId, listedAs }) => {
		const listed = getBuiltInModelPrices(...listedAs);

		expect(listed).toBeDefined();
		expect(getBuiltInModelPrices(provider, modelId)).toEqual(listed);
	});

	it('knows no prices for a model models.dev does not list', () => {
		expect(getBuiltInModelPrices('bedrock', 'eu.anthropic.claude-future-9')).toBeUndefined();
	});
});

describe('resolveModelPrices', () => {
	it('lets declared prices win token type by token type', () => {
		const builtIn = getBuiltInModelPrices('anthropic', 'claude-sonnet-5-5');

		expect(resolveModelPrices('anthropic', 'claude-sonnet-5-5', { output: 99 })).toEqual({
			...builtIn,
			output: 99,
		});
	});

	it('uses declared prices alone for a model models.dev does not list', () => {
		expect(resolveModelPrices('openaiCompatible', 'acme-1', { inputNoCache: 1 })).toEqual({ inputNoCache: 1 });
	});

	it('knows no prices when neither side does', () => {
		expect(resolveModelPrices('openaiCompatible', 'acme-1')).toBeUndefined();
	});
});
