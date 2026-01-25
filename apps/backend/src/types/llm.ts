export type LlmProvider = 'anthropic' | 'openai';

/** Known models for each provider with their display names */
export const KNOWN_MODELS = {
	anthropic: [
		{ id: 'claude-opus-4-5', name: 'Claude Opus 4.5', default: true },
		{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
		{ id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet' },
		{ id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku' },
		{ id: 'claude-3-opus-latest', name: 'Claude 3 Opus' },
	],
	openai: [
		{ id: 'gpt-5.1', name: 'GPT 5.1', default: true },
		{ id: 'gpt-5', name: 'GPT 5' },
		{ id: 'gpt-4.1', name: 'GPT 4.1' },
		{ id: 'gpt-4.1-mini', name: 'GPT 4.1 Mini' },
		{ id: 'o3', name: 'o3' },
		{ id: 'o3-mini', name: 'o3 Mini' },
		{ id: 'gpt-4o', name: 'GPT 4o' },
		{ id: 'gpt-4o-mini', name: 'GPT 4o Mini' },
	],
} as const;

export type AnthropicModel = (typeof KNOWN_MODELS.anthropic)[number]['id'];
export type OpenAIModel = (typeof KNOWN_MODELS.openai)[number]['id'];
export type KnownModelId = AnthropicModel | OpenAIModel;

/** Get the default model for a provider */
export function getDefaultModelId(provider: LlmProvider): string {
	const models = KNOWN_MODELS[provider];
	const defaultModel = models.find((m) => 'default' in m && m.default);
	return defaultModel?.id ?? models[0].id;
}

/** Check if a model ID is known for a provider */
export function isKnownModel(provider: LlmProvider, modelId: string): boolean {
	return KNOWN_MODELS[provider].some((m) => m.id === modelId);
}

/** Get all known model IDs for a provider */
export function getKnownModelIds(provider: LlmProvider): string[] {
	return KNOWN_MODELS[provider].map((m) => m.id);
}
