import { createProviderModel, getDefaultModelId, LLM_PROVIDERS, type ProviderModelResult } from '../agents/providers';
import * as projectLlmConfigQueries from '../queries/project-llm-config.queries';
import { LlmProvider, ModelSelection } from '../types/llm';
export { getDefaultModelId };
export type { ModelSelection };

/** Get the API key from environment for a provider */
export function getEnvApiKey(provider: LlmProvider): string | undefined {
	return process.env[LLM_PROVIDERS[provider].envVar];
}

/** Get the base URL from environment for a provider (e.g. OPENAI_BASE_URL) */
export function getEnvBaseUrl(provider: LlmProvider): string | undefined {
	const { baseUrlEnvVar } = LLM_PROVIDERS[provider];
	return baseUrlEnvVar ? process.env[baseUrlEnvVar] : undefined;
}

/** Check if a provider has an API key configured via environment */
export function hasEnvApiKey(provider: LlmProvider): boolean {
	return !!getEnvApiKey(provider);
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
			{ apiKey: config.apiKey, ...(config.baseUrl && { baseURL: config.baseUrl }) },
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

	return null;
}

export const getProjectAvailableModels = async (
	projectId: string,
): Promise<Array<{ provider: LlmProvider; modelId: string }>> => {
	const configs = await projectLlmConfigQueries.getProjectLlmConfigs(projectId);
	const models: Array<{ provider: LlmProvider; modelId: string }> = [];

	for (const config of configs) {
		const provider = config.provider as LlmProvider;
		const enabledModels = config.enabledModels ?? [];

		if (enabledModels.length === 0) {
			// If no models explicitly enabled, add the default
			models.push({ provider, modelId: getDefaultModelId(provider) });
		} else {
			for (const modelId of enabledModels) {
				models.push({ provider, modelId });
			}
		}
	}

	// Also add env-configured providers with their defaults
	const envSelections = getEnvModelSelections().filter((s) => !configs.some((c) => c.provider === s.provider));
	models.push(...envSelections);

	return models;
};
