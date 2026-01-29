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
export type LlmProvidersType = {
	[P in LlmProvider]: ProviderConfig<P>;
};

/** A provider + model selection */
export type ModelSelection = {
	provider: LlmProvider;
	modelId: string;
};
