import type { AmazonBedrockLanguageModelOptions } from '@ai-sdk/amazon-bedrock';
import type { AnthropicProviderOptions } from '@ai-sdk/anthropic';
import type { OpenAIResponsesProviderOptions as AzureOpenAIResponsesProviderOptions } from '@ai-sdk/azure';
import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google';
import type { MistralLanguageModelOptions } from '@ai-sdk/mistral';
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai';
import type { OpenAICompatibleProviderOptions } from '@ai-sdk/openai-compatible';
import { isLlmProvider, type LlmProvider, type LlmProviderKind } from '@nao/shared/types';
import type { LanguageModelV3, OpenRouterProviderOptions } from '@openrouter/ai-sdk-provider';
import type { JSONValue } from 'ai';
import type { OllamaChatProviderOptions } from 'ai-sdk-ollama';
import { z } from 'zod/v4';

import { TokenCost } from './chat';

export const llmProviderSchema = z.custom<LlmProvider>((value) => typeof value === 'string' && isLlmProvider(value), {
	message: 'Unknown LLM provider',
});

export const llmSelectedModelSchema = z.object({
	provider: llmProviderSchema,
	modelId: z.string(),
});

export type ProviderSettings = { apiKey: string; baseURL?: string; credentials?: Record<string, string> };

export const customModelCostSchema = z.object({
	inputNoCache: z.number().min(0).optional(),
	inputCacheRead: z.number().min(0).optional(),
	inputCacheWrite: z.number().min(0).optional(),
	output: z.number().min(0).optional(),
});

export const customModelMetadataSchema = z.object({
	id: z.string().min(1),
	displayName: z.string().optional(),
	costPerM: customModelCostSchema.optional(),
});

export type ModelCosts = z.infer<typeof customModelCostSchema>;
export type CustomModelMetadata = z.infer<typeof customModelMetadataSchema>;

export const reasoningEffortSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'max']);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

/** Every effort level that is actually sent to a provider (`off` means "leave it to the model"). */
export type ActiveEffort = Exclude<ReasoningEffort, 'off'>;

export const serviceTierSchema = z.enum(['auto', 'default', 'standard', 'flex', 'priority', 'reserved']);
export type ServiceTier = z.infer<typeof serviceTierSchema>;

export const safetyThresholdSchema = z.enum([
	'HARM_BLOCK_THRESHOLD_UNSPECIFIED',
	'BLOCK_LOW_AND_ABOVE',
	'BLOCK_MEDIUM_AND_ABOVE',
	'BLOCK_ONLY_HIGH',
	'BLOCK_NONE',
	'OFF',
]);

export const mediaResolutionSchema = z.enum([
	'MEDIA_RESOLUTION_UNSPECIFIED',
	'MEDIA_RESOLUTION_LOW',
	'MEDIA_RESOLUTION_MEDIUM',
	'MEDIA_RESOLUTION_HIGH',
]);

/**
 * Superset of every per-model inference parameter an admin can tune, keyed by model id in
 * `modelSettings`. A given model only exposes/uses the subset described by its capabilities
 * (see `getModelParameterSpec`); the rest are ignored for that model.
 */
export const modelInferenceSettingsSchema = z.object({
	temperature: z.number().min(0).max(2).optional(),
	topP: z.number().min(0).max(1).optional(),
	topK: z.number().int().min(1).optional(),
	maxOutputTokens: z.number().int().min(1).optional(),
	reasoningEffort: reasoningEffortSchema.optional(),
	thinkingBudgetTokens: z.number().int().min(1024).optional(),
	textVerbosity: z.enum(['low', 'medium', 'high']).optional(),
	reasoningSummary: z.enum(['auto', 'detailed']).optional(),
	parallelToolCalls: z.boolean().optional(),
	maxToolCalls: z.number().int().min(1).optional(),
	serviceTier: serviceTierSchema.optional(),
	speed: z.enum(['standard', 'fast']).optional(),
	inferenceGeo: z.enum(['us', 'global']).optional(),
	sendReasoning: z.boolean().optional(),
	includeThoughts: z.boolean().optional(),
	safetyThreshold: safetyThresholdSchema.optional(),
	mediaResolution: mediaResolutionSchema.optional(),
	safePrompt: z.boolean().optional(),
	documentImageLimit: z.number().int().min(1).optional(),
	documentPageLimit: z.number().int().min(1).optional(),
});
export type ModelInferenceSettings = z.infer<typeof modelInferenceSettingsSchema>;

export const modelSettingsMapSchema = z.record(z.string(), modelInferenceSettingsSchema);
export type ModelSettingsMap = z.infer<typeof modelSettingsMapSchema>;

/** How a model exposes "thinking"/reasoning control, if at all. */
export type ModelThinkingMode = 'adaptive' | 'budget' | 'none';

/** Keys of `ModelInferenceSettings` that can be surfaced as an editable control. */
export type ParamKey = keyof ModelInferenceSettings;

/** Keys rendered as a numeric input. */
export type NumberParamKey = {
	[K in ParamKey]: NonNullable<ModelInferenceSettings[K]> extends number ? K : never;
}[ParamKey];

/** Keys rendered as an on/off/default control. */
export type BooleanParamKey = {
	[K in ParamKey]: NonNullable<ModelInferenceSettings[K]> extends boolean ? K : never;
}[ParamKey];

/** Keys rendered as an enum dropdown. */
export type SelectParamKey = Exclude<
	{
		[K in ParamKey]: NonNullable<ModelInferenceSettings[K]> extends string ? K : never;
	}[ParamKey],
	'reasoningEffort'
>;

/** Provider-specific per-call options a model can additionally expose (beyond the core set). */
export type ExtraParamKey = Exclude<
	ParamKey,
	'temperature' | 'topP' | 'topK' | 'maxOutputTokens' | 'reasoningEffort' | 'thinkingBudgetTokens'
>;

/** Declares which tunable inference parameters a model supports, driving both UI and translation. */
export type ModelCapabilities = {
	thinking: ModelThinkingMode;
	sampling: boolean;
	topK: boolean;
	maxOutputTokens: boolean;
	effortOptions?: ReasoningEffort[];
	/** Effort vocabulary of this model, when it differs from its provider's default translation. */
	effortMap?: Record<ActiveEffort, string>;
	temperatureMax?: number;
	extraParams?: ExtraParamKey[];
	serviceTierOptions?: ServiceTier[];
	/** Provider physical max output tokens; budget-thinking Claude clamps budgets under this since the SDK sends max_tokens = maxOutputTokens + budgetTokens. */
	maxOutputCap?: number;
	thinkingBudgetRange?: { min: number; max: number };
};

/** A single editable inference-parameter control, derived from a model's capabilities. */
export type ParamControl =
	| { key: 'reasoningEffort'; kind: 'effort'; label: string; options: ReasoningEffort[] }
	| {
			key: NumberParamKey;
			kind: 'number';
			label: string;
			placeholder: string;
			step: number;
			min?: number;
			max?: number;
			integer?: boolean;
			group?: 'sampling';
			exclusiveWith?: NumberParamKey;
			lessThan?: NumberParamKey;
	  }
	| { key: SelectParamKey; kind: 'select'; label: string; options: readonly string[] }
	| { key: BooleanParamKey; kind: 'boolean'; label: string };

export const llmConfigSchema = z.object({
	id: z.string(),
	provider: llmProviderSchema,
	apiKeyPreview: z.string().nullable(),
	credentialPreviews: z.record(z.string(), z.string()).nullable(),
	enabledModels: z.array(z.string()).nullable(),
	customModels: z.array(customModelMetadataSchema),
	modelSettings: modelSettingsMapSchema,
	baseUrl: z.string().url().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

/** A provider declared in nao_config.yaml rather than saved from the settings UI. */
export const configLlmProviderSchema = z.object({
	provider: llmProviderSchema,
	apiKeyPreview: z.string().nullable(),
	credentialPreviews: z.record(z.string(), z.string()).nullable(),
	enabledModels: z.array(z.string()),
	customModels: z.array(customModelMetadataSchema),
	modelSettings: modelSettingsMapSchema,
	baseUrl: z.string().nullable(),
});

/** Flatten an interface into a plain type so it gains an implicit index signature. */
type Flatten<T> = { [K in keyof T]: T[K] };

/**
 * Options for providers served through the OpenAI-compatible chat API. Known keys are translated
 * by the SDK; everything else is forwarded verbatim as a request body field, which is how the
 * vendor-specific extensions (`enable_thinking`, `service_tier`, …) are passed.
 */
export type OpenAICompatibleOptions = OpenAICompatibleProviderOptions & Record<string, JSONValue>;

/** Providers served through a plain OpenAI-compatible chat endpoint rather than a dedicated SDK. */
export type OpenAICompatibleProvider = 'qwen' | 'minimax' | 'moonshot' | 'openaiCompatible';

/** Map each provider kind to its specific config type */
export type ProviderConfigMap = {
	google: GoogleGenerativeAIProviderOptions;
	openai: OpenAIResponsesProviderOptions;
	anthropic: AnthropicProviderOptions;
	mistral: MistralLanguageModelOptions;
	openrouter: OpenRouterProviderOptions;
	ollama: Flatten<OllamaChatProviderOptions>;
	bedrock: AmazonBedrockLanguageModelOptions;
	vertex: GoogleGenerativeAIProviderOptions;
	azure: AzureOpenAIResponsesProviderOptions;
	qwen: OpenAICompatibleOptions;
	minimax: OpenAICompatibleOptions;
	moonshot: OpenAICompatibleOptions;
	openaiCompatible: OpenAICompatibleOptions;
};

/** Model definition with provider-specific config type */
type ProviderModel<P extends LlmProviderKind> = {
	id: string;
	name: string;
	default?: boolean;
	contextWindow?: number;
	config?: ProviderConfigMap[P];
	costPerM?: TokenCost;
	/** Tunable inference parameters this model supports. Omit to expose no tunable parameters. */
	capabilities?: ModelCapabilities;
};

/** An additional credential field (e.g. AWS Access Key ID) */
export type AuthField = {
	name: string;
	label: string;
	envVar: string;
	secret?: boolean;
	multiline?: boolean;
	placeholder?: string;
};

/** Describes how a provider authenticates */
export type ProviderAuth = {
	apiKey: 'required' | 'optional' | 'none';
	/**
	 * Alternative ways to authenticate via the environment. Each inner array is a
	 * bundle: every var in a bundle must be set, and any single satisfied bundle is
	 * enough to consider the provider env-configured. Use multi-var bundles for
	 * paired credentials (e.g. access key + secret) and single-var bundles for
	 * ambient signals where the SDK resolves the secret itself (AWS task role,
	 * IRSA, named profile, …).
	 */
	alternativeEnvVars?: string[][];
	hint?: string;
	extraFields?: AuthField[];
};

/** Data-only provider config (no SDK imports, safe for frontend) */
export type ProviderMeta<P extends LlmProviderKind> = {
	auth: ProviderAuth;
	envVar: string;
	baseUrlEnvVar?: string;
	/** Endpoint used when neither the config nor the environment sets a base URL. */
	defaultBaseUrl?: string;
	/** Set when the provider has no vendor endpoint to fall back on, so a base URL must be supplied. */
	requiresBaseUrl?: boolean;
	models: readonly ProviderModel<P>[];
	extractorModelId: string;
	summaryModelId: string;
};

export type ProviderMetaMap = {
	[P in LlmProviderKind]: ProviderMeta<P>;
};

/** Full provider configuration with SDK create function (backend-only) */
type ProviderConfig<P extends LlmProviderKind> = ProviderMeta<P> & {
	create: (settings: ProviderSettings, modelId: string) => LanguageModelV3;
	defaultOptions?: ProviderConfigMap[P];
};

/** Full providers type - each kind gets its own config type */
export type LlmProvidersType = {
	[P in LlmProviderKind]: ProviderConfig<P>;
};

export const LLM_INFERENCE_TYPES = [
	'memory_extraction',
	'compaction',
	'title_generation',
	'live_story_refresh',
] as const;
export type LlmInferenceType = (typeof LLM_INFERENCE_TYPES)[number];
