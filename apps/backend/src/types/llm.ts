import type { AmazonBedrockLanguageModelOptions } from '@ai-sdk/amazon-bedrock';
import type { AnthropicProviderOptions } from '@ai-sdk/anthropic';
import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google';
import type { MistralLanguageModelOptions } from '@ai-sdk/mistral';
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai';
import type { LanguageModelV3, OpenRouterProviderOptions } from '@openrouter/ai-sdk-provider';
import type { OllamaChatProviderOptions } from 'ai-sdk-ollama';
import { z } from 'zod/v4';

import { TokenCost } from './chat';

export const llmProviderSchema = z.enum([
	'openai',
	'anthropic',
	'google',
	'mistral',
	'openrouter',
	'ollama',
	'bedrock',
]);
export type LlmProvider = z.infer<typeof llmProviderSchema>;

export type ProviderSettings = { apiKey: string; baseURL?: string; credentials?: Record<string, string> };

export const llmConfigSchema = z.object({
	id: z.string(),
	provider: llmProviderSchema,
	apiKeyPreview: z.string().nullable(),
	credentialPreviews: z.record(z.string(), z.string()).nullable(),
	enabledModels: z.array(z.string()).nullable(),
	baseUrl: z.string().url().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

/** Flatten an interface into a plain type so it gains an implicit index signature. */
type Flatten<T> = { [K in keyof T]: T[K] };

/** Map each provider to its specific config type */
export type ProviderConfigMap = {
	google: GoogleGenerativeAIProviderOptions;
	openai: OpenAIResponsesProviderOptions;
	anthropic: AnthropicProviderOptions;
	mistral: MistralLanguageModelOptions;
	openrouter: OpenRouterProviderOptions;
	ollama: Flatten<OllamaChatProviderOptions>;
	bedrock: AmazonBedrockLanguageModelOptions;
};

/** Model definition with provider-specific config type */
type ProviderModel<P extends LlmProvider> = {
	id: string;
	name: string;
	default?: boolean;
	contextWindow?: number;
	config?: ProviderConfigMap[P];
	costPerM?: TokenCost;
};

/** An additional credential field (e.g. AWS Access Key ID) */
export type AuthField = {
	name: string;
	label: string;
	envVar: string;
	secret?: boolean;
	placeholder?: string;
};

/** Describes how a provider authenticates */
export type ProviderAuth = {
	apiKey: 'required' | 'optional' | 'none';
	alternativeEnvVars?: string[];
	hint?: string;
	extraFields?: AuthField[];
};

/** Provider configuration with typed models */
type ProviderConfig<P extends LlmProvider> = {
	create: (settings: ProviderSettings, modelId: string) => LanguageModelV3;
	auth: ProviderAuth;
	envVar: string;
	baseUrlEnvVar?: string;
	defaultOptions?: ProviderConfigMap[P];
	models: readonly ProviderModel<P>[];
	extractorModelId: string;
	summaryModelId: string;
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

export const LLM_INFERENCE_TYPES = ['memory_extraction', 'compaction', 'title_generation'] as const;
export type LlmInferenceType = (typeof LLM_INFERENCE_TYPES)[number];
