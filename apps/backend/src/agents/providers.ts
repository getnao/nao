import { type AnthropicProviderOptions, createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

import type { LlmProvider, LlmProvidersType, ProviderConfigMap } from '../types/llm';

// See: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
export const CACHE_1H = { type: 'ephemeral', ttl: '1h' } as const;
export const CACHE_5M = { type: 'ephemeral' } as const;

export type ProviderSettings = { apiKey: string; baseURL?: string };

/** Provider configuration with env var names and known models */
export const LLM_PROVIDERS: LlmProvidersType = {
	anthropic: {
		envVar: 'ANTHROPIC_API_KEY',
		models: [
			{
				id: 'claude-sonnet-4-5',
				name: 'Claude Sonnet 4.5',
				default: true,
				config: {
					thinking: {
						type: 'enabled' as const,
						budgetTokens: 12_000,
					},
				},
				costPerM: {
					inputNoCache: 3,
					inputCacheRead: 0.3,
					inputCacheWrite: 3.75,
					output: 15,
				},
			},
			{
				id: 'claude-opus-4-5',
				name: 'Claude Opus 4.5',
				config: {
					thinking: {
						type: 'enabled' as const,
						budgetTokens: 12_000,
					},
				},
				costPerM: {
					inputNoCache: 5,
					inputCacheRead: 0.5,
					inputCacheWrite: 6.25,
					output: 25,
				},
			},
			{
				id: 'claude-opus-4-6',
				name: 'Claude Opus 4.6',
				config: {
					thinking: {
						type: 'enabled' as const,
						budgetTokens: 12_000,
					},
				},
				costPerM: {
					inputNoCache: 5,
					inputCacheRead: 0.5,
					inputCacheWrite: 6.25,
					output: 25,
				},
			},
			{
				id: 'claude-haiku-4-5',
				name: 'Claude Haiku 4.5',
				costPerM: {
					inputNoCache: 1,
					inputCacheRead: 0.1,
					inputCacheWrite: 1.25,
					output: 5,
				},
			},
		],
	},
	openai: {
		envVar: 'OPENAI_API_KEY',
		models: [
			{
				id: 'gpt-5.2',
				name: 'GPT 5.2',
				default: true,
				costPerM: { inputNoCache: 1.75, inputCacheRead: 0.175, inputCacheWrite: 0, output: 14 },
			},
			{
				id: 'gpt-5-mini',
				name: 'GPT 5 mini',
				costPerM: { inputNoCache: 0.25, inputCacheRead: 0.025, inputCacheWrite: 0, output: 2 },
			},
			{
				id: 'gpt-4.1',
				name: 'GPT 4.1',
				costPerM: { inputNoCache: 3, inputCacheRead: 0.75, inputCacheWrite: 0, output: 12 },
			},
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

/** Default provider options applied to all models of a provider */
const DEFAULT_PROVIDER_OPTIONS: { [P in LlmProvider]?: ProviderConfigMap[P] } = {
	anthropic: {
		disableParallelToolUse: false,
	} satisfies AnthropicProviderOptions,
	// Avoid item references (fc_*, etc.) so agentic loops work with Zero Data Retention orgs.
	openai: { store: false },
};

type ModelCreator = (settings: ProviderSettings, modelId: string) => LanguageModel;

const MODEL_CREATORS: Record<LlmProvider, ModelCreator> = {
	anthropic: (settings, modelId) => createAnthropic(settings).chat(modelId),
	google: (settings, modelId) => createGoogleGenerativeAI(settings).chat(modelId),
	mistral: (settings, modelId) => createMistral(settings).chat(modelId),
	openai: (settings, modelId) => createOpenAI(settings).responses(modelId),
};

type ProviderModelResult = {
	model: LanguageModel;
	providerOptions: Partial<{ [P in LlmProvider]: ProviderConfigMap[P] }>;
};

/** Create a language model instance with merged provider options */
export function createProviderModel(
	provider: LlmProvider,
	settings: ProviderSettings,
	modelId: string,
): ProviderModelResult {
	const model = MODEL_CREATORS[provider](settings, modelId);
	const defaultOptions = DEFAULT_PROVIDER_OPTIONS[provider] ?? {};
	const modelConfig = getProviderModelConfig(provider, modelId);

	return {
		model,
		providerOptions: {
			[provider]: { ...defaultOptions, ...modelConfig },
		},
	};
}
