import type { LlmProvider, LlmSelectedModel } from '@nao/shared/types';

import { createProviderModel, getDefaultModelId, LLM_PROVIDERS, type ProviderModelResult } from '../agents/providers';
import * as projectLlmConfigQueries from '../queries/project-llm-config.queries';
import type { ProviderSettings } from '../types/llm';

export { getDefaultModelId };

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
export function getEnvModelSelections(): LlmSelectedModel[] {
	return getEnvProviders().map((provider) => ({
		provider,
		modelId: getDefaultModelId(provider),
	}));
}

/** Resolve API key + base URL for a provider from DB config or env vars. */
export async function resolveProviderSettings(
	projectId: string,
	provider: LlmProvider,
): Promise<ProviderSettings | null> {
	const config = await projectLlmConfigQueries.getProjectLlmConfigByProvider(projectId, provider);
	if (config) {
		return {
			apiKey: config.apiKey,
			...(config.baseUrl && { baseURL: config.baseUrl }),
			...(config.credentials && { credentials: config.credentials }),
		};
	}

	const envApiKey = getEnvApiKey(provider);
	if (envApiKey) {
		const envBaseUrl = getEnvBaseUrl(provider);
		return { apiKey: envApiKey, ...(envBaseUrl && { baseURL: envBaseUrl }) };
	}

	if (hasEnvApiKey(provider)) {
		return { apiKey: '' };
	}

	return null;
}

/**
 * Resolve a provider model from DB config, falling back to env vars.
 * Returns null when neither source has credentials for the provider.
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

	return null;
}

/**
 * Resolve the model to use for background tasks (memory extraction, compaction, title generation).
 * Priority: NAO_ANNOTATION_MODEL env var > first enabled model in project config > provider default.
 */
export async function resolveAnnotationModelId(
	projectId: string,
	provider: LlmProvider,
	fallbackModelId: string,
): Promise<string> {
	const envOverride = process.env.NAO_ANNOTATION_MODEL;
	if (envOverride) {
		return envOverride;
	}

	const config = await projectLlmConfigQueries.getProjectLlmConfigByProvider(projectId, provider);
	const enabledModels = config?.enabledModels ?? [];
	if (enabledModels.length > 0) {
		return enabledModels[0];
	}

	return fallbackModelId;
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

	return models;
};

const getModelName = (provider: LlmProvider, modelId: string): string =>
	LLM_PROVIDERS[provider].models.find((m) => m.id === modelId)?.name ?? modelId;
