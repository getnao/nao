import { getDefaultModelId, LLM_PROVIDERS } from '../agents/providers';
import * as projectLlmConfigQueries from '../queries/project-llm-config.queries';
import { LlmProvider, ModelSelection } from '../types/llm';
export { getDefaultModelId };
export type { ModelSelection };

/** Get the API key from environment for a provider */
export function getEnvApiKey(provider: LlmProvider): string | undefined {
	return process.env[LLM_PROVIDERS[provider].envVar];
}

/** Check if a provider has an API key configured via environment */
export function hasEnvApiKey(provider: LlmProvider): boolean {
	return !!getEnvApiKey(provider);
}

/** Get all providers that have API keys configured via environment */
export function getEnvProviders(): LlmProvider[] {
	return (Object.keys(LLM_PROVIDERS) as LlmProvider[]).filter(hasEnvApiKey);
}

/** Get the first available provider from env (preferring anthropic) */
export function getDefaultEnvProvider(): LlmProvider | undefined {
	if (hasEnvApiKey('anthropic')) return 'anthropic';
	if (hasEnvApiKey('openai')) return 'openai';
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
