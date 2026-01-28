import type { AnthropicProviderOptions } from '@ai-sdk/anthropic';
import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google';
import type { MistralLanguageModelOptions } from '@ai-sdk/mistral';
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai';
import { z } from 'zod';

export const llmProviderSchema = z.enum(['openai', 'anthropic', 'google', 'mistral']);
export type LlmProvider = z.infer<typeof llmProviderSchema>;

export const llmConfigSchema = z.object({
	id: z.string(),
	provider: llmProviderSchema,
	apiKeyPreview: z.string().nullable(),
	enabledModels: z.array(z.string()).nullable(),
	baseUrl: z.string().url().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

/** Map each provider to its specific config type */
export type ProviderConfigMap = {
	google: GoogleGenerativeAIProviderOptions;
	openai: OpenAIResponsesProviderOptions;
	anthropic: AnthropicProviderOptions;
	mistral: MistralLanguageModelOptions;
};

/** Model definition with provider-specific config type */
type ProviderModel<P extends LlmProvider> = {
	id: string;
	name: string;
	default?: boolean;
	config?: ProviderConfigMap[P];
};

/** Provider configuration with typed models */
type ProviderConfig<P extends LlmProvider> = {
	envVar: string;
	models: readonly ProviderModel<P>[];
};

/** Full providers type - each key gets its own config type */
type LlmProvidersType = {
	[P in LlmProvider]: ProviderConfig<P>;
};

/** Provider configuration with env var names and known models */
export const LLM_PROVIDERS: LlmProvidersType = {
	anthropic: {
		envVar: 'ANTHROPIC_API_KEY',
		models: [
			{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', default: true },
			{ id: 'claude-opus-4-5', name: 'Claude Opus 4.5' },
			{ id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
		],
	},
	openai: {
		envVar: 'OPENAI_API_KEY',
		models: [
			{ id: 'gpt-5.2', name: 'GPT 5.2', default: true },
			{ id: 'gpt-5-mini', name: 'GPT 5 mini' },
			{ id: 'gpt-4.1', name: 'GPT 4.1' },
		],
	},
	google: {
		envVar: 'GEMINI_API_KEY',
		models: [
			{
				id: 'gemini-3-pro-preview',
				name: 'Gemini 3 Pro',
				default: true,
				config: {
					thinkingConfig: {
						thinkingLevel: 'high',
						includeThoughts: true,
					},
				},
			},
			{ id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash' },
			{
				id: 'gemini-2.5-pro',
				name: 'Gemini 2.5 Pro',
				config: {
					thinkingConfig: {
						thinkingBudget: 8192,
						includeThoughts: true,
					},
				},
			},
			{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
		],
	},
	mistral: {
		envVar: 'MISTRAL_API_KEY',
		models: [
			{ id: 'mistral-medium-latest', name: 'Mistral Medium 3.1', default: true },
			{ id: 'mistral-large-latest', name: 'Mistral Large 3' },
		],
	},
};

/** Known models for each provider (legacy format for API compatibility) */
export const KNOWN_MODELS = Object.fromEntries(
	Object.entries(LLM_PROVIDERS).map(([provider, config]) => [provider, config.models]),
) as { [K in LlmProvider]: (typeof LLM_PROVIDERS)[K]['models'] };

export function getDefaultModelId(provider: LlmProvider): string {
	const models = LLM_PROVIDERS[provider].models;
	const defaultModel = models.find((m) => m.default);
	return defaultModel?.id ?? models[0].id;
}

export function getProviderModelConfig<P extends LlmProvider>(provider: P, modelId: string): ProviderConfigMap[P] {
	const model = LLM_PROVIDERS[provider].models.find((m) => m.id === modelId);
	return (model?.config ?? {}) as ProviderConfigMap[P];
}

/** A provider + model selection */
export type ModelSelection = {
	provider: LlmProvider;
	modelId: string;
};
