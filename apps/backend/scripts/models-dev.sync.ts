/**
 * Refreshes `src/data/model-prices.json` from models.dev, the price table nao bundles so it never
 * calls models.dev at runtime. Run with `npm run -w @nao/backend models:sync`.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { LlmProviderKind } from '@nao/shared/types';

const MODELS_DEV_URL = 'https://models.dev/api.json';
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
	modelIds?: (modelsDevId: string, model: ModelsDevModel) => string[];
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
	qwen: [{ provider: 'alibaba' }],
	minimax: [{ provider: 'minimax' }],
	moonshot: [{ provider: 'moonshotai' }],
	meta: [{ provider: 'meta' }],
	openaiCompatible: [],
};

async function main(): Promise<void> {
	const catalog = await fetchCatalog();
	const prices = Object.fromEntries(
		Object.entries(PRICE_SOURCES).map(([kind, sources]) => [kind, collectPrices(catalog, sources)]),
	);
	writeFileSync(OUTPUT_PATH, serialize(prices));
	const modelCount = Object.values(prices).reduce((count, models) => count + Object.keys(models).length, 0);
	console.log(`Wrote prices of ${modelCount} models to ${OUTPUT_PATH}`);
}

async function fetchCatalog(): Promise<ModelsDevCatalog> {
	const response = await fetch(MODELS_DEV_URL);
	if (!response.ok) {
		throw new Error(`models.dev answered ${response.status} ${response.statusText}`);
	}
	return (await response.json()) as ModelsDevCatalog;
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
			if (!modelPrices) {
				continue;
			}
			prices.set(modelsDevId, modelPrices);
			for (const alias of source.modelIds?.(modelsDevId, model) ?? []) {
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

/** Vertex takes `claude-sonnet-4-6` where models.dev lists `claude-sonnet-4-6@default`. */
function withoutDefaultVersion(modelsDevId: string): string[] {
	return modelsDevId.endsWith('@default') ? [modelsDevId.slice(0, -'@default'.length)] : [];
}

/** Requesty routes `anthropic/claude-sonnet-4-5`, which models.dev lists as `claude-sonnet-4-5`. */
function withCanonicalId(modelsDevId: string, model: ModelsDevModel): string[] {
	return model.canonical_model_id && !modelsDevId.includes('@') ? [model.canonical_model_id] : [];
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
