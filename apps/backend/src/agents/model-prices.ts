import { type LlmProvider, type LlmProviderKind, providerKind } from '@nao/shared/types';

import bundledPrices from '../data/model-prices.json';
import { type DecisionProvider, isDecisionProvider } from '../types/decision';
import type { ModelCosts } from '../types/llm';
import { bedrockGeoTwinIds } from './provider-meta';

/** A provider whose calls are priced: decision providers are billed like LLM ones, by the token. */
export type PricedProvider = LlmProvider | DecisionProvider;

/** Prices per million tokens from models.dev, refreshed with `npm run models:sync`. */
const MODEL_PRICES: Record<LlmProviderKind | DecisionProvider, Record<string, ModelCosts>> = bundledPrices;

/**
 * Prices of a model: those declared for it win over the models.dev ones, token type by token type.
 * Undefined when neither knows the model.
 */
export function resolveModelPrices(
	provider: PricedProvider,
	modelId: string,
	declaredPrices?: ModelCosts,
): ModelCosts | undefined {
	const builtInPrices = getBuiltInModelPrices(provider, modelId);
	return builtInPrices || declaredPrices ? { ...builtInPrices, ...declaredPrices } : undefined;
}

/** An unlisted Bedrock geo id (`apac.`, `us-gov.`...) takes the prices of its `us.` or `global.` twin. */
export function getBuiltInModelPrices(provider: PricedProvider, modelId: string): ModelCosts | undefined {
	const kind = isDecisionProvider(provider) ? provider : providerKind(provider);
	const prices = MODEL_PRICES[kind];
	if (prices[modelId] || kind !== 'bedrock') {
		return prices[modelId];
	}
	return bedrockGeoTwinIds(modelId)
		.map((twinId) => prices[twinId])
		.find(Boolean);
}
