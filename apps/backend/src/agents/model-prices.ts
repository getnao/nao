import { type LlmProvider, type LlmProviderKind, providerKind } from '@nao/shared/types';

import bundledPrices from '../data/model-prices.json';
import type { ModelCosts } from '../types/llm';
import { bedrockGeoTwinIds } from './provider-meta';

/** Prices per million tokens from models.dev, refreshed with `npm run models:sync`. */
const MODEL_PRICES: Record<LlmProviderKind, Record<string, ModelCosts>> = bundledPrices;

/**
 * Prices of a model: those declared for it win over the models.dev ones, token type by token type.
 * Undefined when neither knows the model.
 */
export function resolveModelPrices(
	provider: LlmProvider,
	modelId: string,
	declaredPrices?: ModelCosts,
): ModelCosts | undefined {
	const builtInPrices = getBuiltInModelPrices(provider, modelId);
	return builtInPrices || declaredPrices ? { ...builtInPrices, ...declaredPrices } : undefined;
}

/** An unlisted Bedrock geo id (`apac.`, `us-gov.`...) takes the prices of its `us.` or `global.` twin. */
export function getBuiltInModelPrices(provider: LlmProvider, modelId: string): ModelCosts | undefined {
	const kind = providerKind(provider);
	const prices = MODEL_PRICES[kind];
	if (prices[modelId] || kind !== 'bedrock') {
		return prices[modelId];
	}
	return bedrockGeoTwinIds(modelId)
		.map((twinId) => prices[twinId])
		.find(Boolean);
}
