import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse as parseYaml } from 'yaml';

import { createProviderModel, getDefaultModelId, LLM_PROVIDERS, type ProviderModelResult } from '../agents/providers';
import * as projectLlmConfigQueries from '../queries/project-llm-config.queries';
import { LlmProvider, ModelSelection, type ProviderSettings } from '../types/llm';
export { getDefaultModelId };
export type { ModelSelection };

type NaoConfigLlm = { provider: LlmProvider; api_key?: string; base_url?: string };

/** Read the llm section from nao_config.yaml in the project folder, if present. */
function readNaoConfigLlm(): NaoConfigLlm | null {
	const projectFolder = process.env.NAO_DEFAULT_PROJECT_PATH;
	if (!projectFolder) {
		return null;
	}
	try {
		const raw = readFileSync(join(projectFolder, 'nao_config.yaml'), 'utf8');
		const config = parseYaml(raw) as { llm?: NaoConfigLlm };
		return config?.llm ?? null;
	} catch {
		return null;
	}
}

/** Get the API key from environment for a provider */
export function getEnvApiKey(provider: LlmProvider): string | undefined {
	return process.env[LLM_PROVIDERS[provider].envVar];
}

/** Get the base URL from environment for a provider (e.g. OPENAI_BASE_URL) */
export function getEnvBaseUrl(provider: LlmProvider): string | undefined {
	const { baseUrlEnvVar } = LLM_PROVIDERS[provider];
	return baseUrlEnvVar ? process.env[baseUrlEnvVar] : undefined;
}

/** Check if a provider has authentication configured via environment */
export function hasEnvApiKey(provider: LlmProvider): boolean {
	if (getEnvApiKey(provider)) {
		return true;
	}
	const { alternativeEnvVars } = LLM_PROVIDERS[provider].auth;
	return alternativeEnvVars?.every((v) => process.env[v]) ?? false;
}

/** Get all providers that have API keys configured via environment */
export function getEnvProviders(): LlmProvider[] {
	return (Object.keys(LLM_PROVIDERS) as LlmProvider[]).filter(hasEnvApiKey);
}

/** Get base URLs set via environment, keyed by provider */
export function getEnvBaseUrls(): Record<string, string> {
	return Object.fromEntries(
		getEnvProviders()
			.map((p) => [p, getEnvBaseUrl(p)] as const)
			.filter((entry): entry is [LlmProvider, string] => !!entry[1]),
	);
}

/** Get the first available provider from env (preferring anthropic) */
export function getDefaultEnvProvider(): LlmProvider | undefined {
	if (hasEnvApiKey('anthropic')) {
		return 'anthropic';
	}
	if (hasEnvApiKey('openai')) {
		return 'openai';
	}
	return undefined;
}

/** Check if a model ID is known for a provider */
export function isKnownModel(provider: LlmProvider, modelId: string): boolean {
	return LLM_PROVIDERS[provider].models.some((m) => m.id === modelId);
}

/** Get all known model IDs for a provider */
export function getKnownModelIds(provider: LlmProvider): string[] {
	return LLM_PROVIDERS[provider].models.map((m) => m.id);
}

/** Get model selections for all env-configured providers */
export function getEnvModelSelections(): ModelSelection[] {
	return getEnvProviders().map((provider) => ({
		provider,
		modelId: getDefaultModelId(provider),
	}));
}

/** Resolve API key + base URL for a provider from DB config, env vars, or nao_config.yaml. */
export async function resolveProviderSettings(
	projectId: string,
	provider: LlmProvider,
): Promise<ProviderSettings | null> {
	const config = await projectLlmConfigQueries.getProjectLlmConfigByProvider(projectId, provider);
	if (config) {
		return { apiKey: config.apiKey, ...(config.baseUrl && { baseURL: config.baseUrl }) };
	}

	const envApiKey = getEnvApiKey(provider);
	if (envApiKey) {
		const envBaseUrl = getEnvBaseUrl(provider);
		return { apiKey: envApiKey, ...(envBaseUrl && { baseURL: envBaseUrl }) };
	}

	const naoLlm = readNaoConfigLlm();
	if (naoLlm?.provider === provider && naoLlm.api_key) {
		return { apiKey: naoLlm.api_key, ...(naoLlm.base_url && { baseURL: naoLlm.base_url }) };
	}

	return null;
}

/**
 * Resolve a provider model from DB config, env vars, or nao_config.yaml.
 * Returns null when no source has credentials for the provider.
 */
export async function resolveProviderModel(
	projectId: string,
	provider: LlmProvider,
	modelId: string,
): Promise<ProviderModelResult | null> {
	const config = await projectLlmConfigQueries.getProjectLlmConfigByProvider(projectId, provider);
	if (config) {
		return createProviderModel(
			provider,
			{
				apiKey: config.apiKey,
				...(config.baseUrl && { baseURL: config.baseUrl }),
				...(config.credentials && { credentials: config.credentials }),
			},
			modelId,
		);
	}

	const envApiKey = getEnvApiKey(provider);
	if (envApiKey) {
		const envBaseUrl = getEnvBaseUrl(provider);
		return createProviderModel(
			provider,
			{ apiKey: envApiKey, ...(envBaseUrl && { baseURL: envBaseUrl }) },
			modelId,
		);
	}

	if (hasEnvApiKey(provider)) {
		return createProviderModel(provider, { apiKey: '' }, modelId);
	}

	const naoLlm = readNaoConfigLlm();
	if (naoLlm?.provider === provider && naoLlm.api_key) {
		return createProviderModel(
			provider,
			{ apiKey: naoLlm.api_key, ...(naoLlm.base_url && { baseURL: naoLlm.base_url }) },
			modelId,
		);
	}

	return null;
}

export const getProjectAvailableModels = async (
	projectId: string,
): Promise<Array<{ provider: LlmProvider; modelId: string; name: string }>> => {
	const configs = await projectLlmConfigQueries.getProjectLlmConfigs(projectId);
	const models: Array<{ provider: LlmProvider; modelId: string; name: string }> = [];

	for (const config of configs) {
		const provider = config.provider as LlmProvider;
		const enabledModels = config.enabledModels ?? [];

		if (enabledModels.length === 0) {
			// If no models explicitly enabled, add the default
			const defaultModelId = getDefaultModelId(provider);
			models.push({ provider, modelId: defaultModelId, name: getModelName(provider, defaultModelId) });
		} else {
			for (const modelId of enabledModels) {
				models.push({ provider, modelId, name: getModelName(provider, modelId) });
			}
		}
	}

	// Also add env-configured providers with their defaults
	const envSelections = getEnvModelSelections()
		.filter((s) => !configs.some((c) => c.provider === s.provider))
		.map((s) => ({ ...s, name: getModelName(s.provider, s.modelId) }));
	models.push(...envSelections);

	// Also add the nao_config.yaml provider if not already covered by DB or env
	const naoLlm = readNaoConfigLlm();
	if (naoLlm?.api_key) {
		const alreadyCovered =
			configs.some((c) => c.provider === naoLlm.provider) ||
			envSelections.some((s) => s.provider === naoLlm.provider);
		if (!alreadyCovered) {
			const modelId = getDefaultModelId(naoLlm.provider);
			models.push({ provider: naoLlm.provider, modelId, name: getModelName(naoLlm.provider, modelId) });
		}
	}

	return models;
};

const getModelName = (provider: LlmProvider, modelId: string): string =>
	LLM_PROVIDERS[provider].models.find((m) => m.id === modelId)?.name ?? modelId;
