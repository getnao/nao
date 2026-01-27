export type LlmProvider = 'anthropic' | 'openai';

/** Known models for each provider with their display names */
export const KNOWN_MODELS = {
	anthropic: [
		{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', default: true },
		{ id: 'claude-opus-4-5', name: 'Claude Opus 4.5' },
		{ id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
	],
	openai: [
		{ id: 'gpt-5.2', name: 'GPT 5.2', default: true },
		{ id: 'gpt-5.2-pro', name: 'GPT 5.2 pro' },
		{ id: 'gpt-5-mini', name: 'GPT 5 mini' },
		{ id: 'gpt-4.1', name: 'GPT 4.1' },
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
