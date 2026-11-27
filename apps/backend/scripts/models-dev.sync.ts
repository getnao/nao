/**
 * Refreshes `src/data/model-prices.json` from models.dev, the price table nao bundles so it never
 * calls models.dev at runtime. Run with `npm run -w @nao/backend models:sync`.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { LlmProviderKind } from '@nao/shared/types';

import type { DecisionProvider } from '../src/types/decision';

const MODELS_DEV_URL = 'https://models.dev/api.json';
const MODELS_DEV_DECISION_URL = `${MODELS_DEV_URL}?type=decision`;
const OUTPUT_PATH = fileURLToPath(new URL('../src/data/model-prices.json', import.meta.url));

type ModelsDevModel = {
	canonical_model_id?: string;
	cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
};
type ModelsDevCatalog = Record<string, { models: Record<string, ModelsDevModel> }>;
type ModelPrices = { inputNoCache?: number; inputCacheRead?: number; inputCacheWrite?: number; output?: number };

type PriceSource = {
	provider: string;
	/** The ids nao sends to the provider for a models.dev entry, when they differ from its models.dev id. */
	modelIds?: (modelsDevId: string, model: ModelsDevModel, models: Record<string, ModelsDevModel>) => string[];
	/** The id nao sends in place of the models.dev one, undefined for a model the nao provider does not serve. */
	rename?: (modelsDevId: string, model: ModelsDevModel) => string | undefined;
};

const PRICE_SOURCES: Record<LlmProviderKind, PriceSource[]> = {
	nao: [{ provider: 'openai' }],
	anthropic: [{ provider: 'anthropic' }],
	openai: [{ provider: 'openai' }],
	google: [{ provider: 'google' }],
	vertex: [
		{ provider: 'google-vertex', modelIds: withoutDefaultVersion },
		{ provider: 'google-vertex-anthropic', modelIds: withoutDefaultVersion },
	],
	mistral: [{ provider: 'mistral' }],
	openrouter: [{ provider: 'openrouter' }],
	requesty: [{ provider: 'requesty', modelIds: withCanonicalId }],
	ollama: [],
	bedrock: [{ provider: 'amazon-bedrock' }],
	azure: [{ provider: 'azure' }],
	databricks: [],
	qwen: [{ provider: 'alibaba' }],
	minimax: [{ provider: 'minimax' }],
	moonshot: [{ provider: 'moonshotai' }],
	meta: [{ provider: 'meta' }],
	openaiCompatible: [],
};

/** Decision providers that are also LLM providers are priced by their LLM entry. */
const DECISION_PRICE_SOURCES: Record<Exclude<DecisionProvider, LlmProviderKind>, PriceSource[]> = {
	typesafe: [
		{ provider: 'openrouter', rename: (_id, model) => withoutPrefix(model.canonical_model_id, 'typesafe/') },
	],
	cloudflare: [{ provider: 'cloudflare-workers-ai', rename: (id) => withoutPrefix(id, '@cf/cloudflare/') }],
	systemOne: [],
};

async function main(): Promise<void> {
	const [catalog, decisionCatalog] = await Promise.all([
		fetchCatalog(MODELS_DEV_URL),
		fetchCatalog(MODELS_DEV_DECISION_URL),
	]);
	const prices = {
		...collectProviderPrices(catalog, PRICE_SOURCES),
		...collectProviderPrices(decisionCatalog, DECISION_PRICE_SOURCES),
	};
	writeFileSync(OUTPUT_PATH, serialize(prices));
	const modelCount = Object.values(prices).reduce((count, models) => count + Object.keys(models).length, 0);
	console.log(`Wrote prices of ${modelCount} models to ${OUTPUT_PATH}`);
}

async function fetchCatalog(url: string): Promise<ModelsDevCatalog> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`models.dev answered ${response.status} ${response.statusText}`);
	}
	return (await response.json()) as ModelsDevCatalog;
}

function collectProviderPrices(
	catalog: ModelsDevCatalog,
	sourcesByProvider: Record<string, PriceSource[]>,
): Record<string, Record<string, ModelPrices>> {
	return Object.fromEntries(
		Object.entries(sourcesByProvider).map(([provider, sources]) => [provider, collectPrices(catalog, sources)]),
	);
}

function collectPrices(catalog: ModelsDevCatalog, sources: PriceSource[]): Record<string, ModelPrices> {
	const prices = new Map<string, ModelPrices>();
	for (const source of sources) {
		const models = catalog[source.provider]?.models;
		if (!models) {
			throw new Error(`models.dev no longer lists the provider ${source.provider}`);
		}
		for (const [modelsDevId, model] of Object.entries(models)) {
			const modelPrices = toModelPrices(model);
			const modelId = source.rename ? source.rename(modelsDevId, model) : modelsDevId;
			if (!modelPrices || !modelId) {
				continue;
			}
			prices.set(modelId, modelPrices);
			for (const alias of source.modelIds?.(modelsDevId, model, models) ?? []) {
				if (!models[alias] && !prices.has(alias)) {
					prices.set(alias, modelPrices);
				}
			}
		}
	}
	return Object.fromEntries([...prices].sort(([a], [b]) => a.localeCompare(b)));
}

function toModelPrices(model: ModelsDevModel): ModelPrices | undefined {
	if (model.cost?.input === undefined && model.cost?.output === undefined) {
		return undefined;
	}
	return {
		inputNoCache: model.cost.input,
		inputCacheRead: model.cost.cache_read,
		inputCacheWrite: model.cost.cache_write,
		output: model.cost.output,
	};
}

function withoutPrefix(id: string | undefined, prefix: string): string | undefined {
	return id?.startsWith(prefix) ? id.slice(prefix.length) : undefined;
}

/** Vertex takes `claude-sonnet-4-6` where models.dev lists `claude-sonnet-4-6@default`. */
function withoutDefaultVersion(modelsDevId: string): string[] {
	return modelsDevId.endsWith('@default') ? [modelsDevId.slice(0, -'@default'.length)] : [];
}

/**
 * Requesty routes `anthropic/claude-sonnet-4-5`, which models.dev lists as `claude-sonnet-4-5`. When variants share a
 * canonical id (`kimi-k3.1-pro`, `kimi-k3.1-pro-highspeed`), only the one named like it lends its price, whatever the
 * entry order.
 */
function withCanonicalId(modelsDevId: string, model: ModelsDevModel, models: Record<string, ModelsDevModel>): string[] {
	const canonicalId = model.canonical_model_id;
	if (!canonicalId || modelsDevId.includes('@')) {
		return [];
	}
	const variants = Object.keys(models).filter(
		(id) => !id.includes('@') && models[id].canonical_model_id === canonicalId,
	);
	const priceSource =
		variants.length === 1
			? variants[0]
			: variants.find((id) => canonicalId.toLowerCase().endsWith(`/${id.toLowerCase()}`));
	return priceSource === modelsDevId ? [canonicalId] : [];
}

/** One model per line, so a refresh reads as a short diff. */
function serialize(prices: Record<string, Record<string, ModelPrices>>): string {
	const providers = Object.entries(prices).map(([kind, models]) => {
		const lines = Object.entries(models).map(
			([id, price]) => `\t\t${JSON.stringify(id)}: ${JSON.stringify(price)}`,
		);
		return lines.length
			? `\t${JSON.stringify(kind)}: {\n${lines.join(',\n')}\n\t}`
			: `\t${JSON.stringify(kind)}: {}`;
	});
	return `{\n${providers.join(',\n')}\n}\n`;
}

await main();
