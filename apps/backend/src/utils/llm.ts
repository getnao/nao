import { getDefaultModelId, LLM_PROVIDERS, LlmProvider } from '../types/llm';
export { getDefaultModelId };

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
