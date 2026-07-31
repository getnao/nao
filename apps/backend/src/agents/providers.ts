import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { type AnthropicProviderOptions, createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import {
	type LlmProvider,
	type LlmProviderKind,
	NAMED_PROVIDER_KIND,
	type NamedLlmProvider,
	providerKind,
	providerLabel,
	providerName,
} from '@nao/shared/types';
import { createOpenRouter, LanguageModelV3 } from '@openrouter/ai-sdk-provider';
import { createOllama } from 'ai-sdk-ollama';

import type {
	ActiveEffort,
	LlmProvidersType,
	ModelCapabilities,
	ModelInferenceSettings,
	ProviderConfigMap,
	ProviderSettings,
	ReasoningEffort,
} from '../types/llm';
import {
	DEFAULT_TEMPERATURE_MAX,
	EFFORT_OPTIONS,
	EFFORT_TO_ANTHROPIC,
	EFFORT_TO_BEDROCK,
	EFFORT_TO_GEMINI_LEVEL,
	EFFORT_TO_OPENAI,
	getModelCapabilities,
	isAnthropicApiModel,
	OPENAI_COMPATIBLE_BASE_URLS,
	PROVIDER_META,
} from './provider-meta';

export {
	getDefaultModelId,
	getProviderApiKeyRequirement,
	getProviderAuth,
	getProviderMeta,
	KNOWN_MODELS,
	PROVIDER_META,
} from './provider-meta';

export const CACHE_1H = { type: 'ephemeral', ttl: '1h' } as const;
export const CACHE_5M = { type: 'ephemeral' } as const;

export const LLM_PROVIDERS: LlmProvidersType = {
	anthropic: {
		...PROVIDER_META.anthropic,
		create: (settings, modelId) => createAnthropic(settings).chat(modelId),
		defaultOptions: {
			disableParallelToolUse: false,
			contextManagement: {
				edits: [
					{
						type: 'clear_tool_uses_20250919',
						trigger: {
							type: 'input_tokens',
							value: 180_000,
						},
						clearToolInputs: false,
						excludeTools: [
							'display_chart',
							'execute_python',
							'execute_sql',
							'execute_sandboxed_code',
							'grep',
							'list',
							'read',
							'search',
							'story',
						],
					},
				],
			},
		} satisfies AnthropicProviderOptions,
	},
	openai: {
		...PROVIDER_META.openai,
		create: (settings, modelId) => createOpenAI(settings).responses(modelId),
		defaultOptions: { store: false, truncation: 'auto', reasoningSummary: 'auto' },
	},
	google: {
		...PROVIDER_META.google,
		create: (settings, modelId) => createGoogleGenerativeAI(settings).chat(modelId),
	},
	mistral: {
		...PROVIDER_META.mistral,
		create: (settings, modelId) => createMistral(settings).chat(modelId),
	},
	openrouter: {
		...PROVIDER_META.openrouter,
		create: (settings, modelId) => createOpenRouter(settings).chat(modelId),
	},
	ollama: {
		...PROVIDER_META.ollama,
		create: (settings, modelId) => createOllama(settings).chat(modelId),
	},
	bedrock: {
		...PROVIDER_META.bedrock,
		create: (settings, modelId) => {
			const creds = settings.credentials;
			const region = creds?.region || process.env.AWS_REGION || 'us-east-1';
			const resolvedModelId = resolveBedrockModelId(modelId, region);
			let config;

			if (settings.apiKey) {
				config = { apiKey: settings.apiKey, region };
			} else if (creds?.accessKeyId && creds?.secretAccessKey) {
				config = {
					region,
					accessKeyId: creds.accessKeyId,
					secretAccessKey: creds.secretAccessKey,
					...(creds.sessionToken && { sessionToken: creds.sessionToken }),
				};
			} else if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
				config = {
					region,
					accessKeyId: process.env.AWS_ACCESS_KEY_ID,
					secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
					...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
				};
			} else {
				config = {
					region,
					credentialProvider: fromNodeProviderChain({
						profile: process.env.AWS_PROFILE,
						ignoreCache: true,
					}),
				};
			}

			return createAmazonBedrock(config).languageModel(resolvedModelId);
		},
	},
	vertex: {
		...PROVIDER_META.vertex,
		create: (settings, modelId) => {
			const creds = settings.credentials;
			const project = creds?.project || process.env.GOOGLE_VERTEX_PROJECT;
			const location = creds?.location || process.env.GOOGLE_VERTEX_LOCATION || 'global';

			const googleAuthOptions = buildVertexAuthOptions(creds);
			const config = { project, location, baseURL: settings.baseURL, googleAuthOptions };

			if (modelId.startsWith('claude-')) {
				return createVertexAnthropic(config)(modelId);
			}
			return createVertex(config)(modelId);
		},
	},
	azure: {
		...PROVIDER_META.azure,
		create: (settings, modelId) => {
			const creds = settings.credentials;
			const resourceName = creds?.resourceName || process.env.AZURE_RESOURCE_NAME;
			const apiVersion = creds?.apiVersion || process.env.AZURE_API_VERSION;
			const useDeploymentBasedUrls =
				(creds?.useDeploymentBasedUrls || process.env.AZURE_USE_DEPLOYMENT_BASED_URLS) === 'true';

			return createAzure({
				apiKey: settings.apiKey,
				...(settings.baseURL ? { baseURL: settings.baseURL } : resourceName ? { resourceName } : {}),
				...(apiVersion && { apiVersion }),
				...(useDeploymentBasedUrls && { useDeploymentBasedUrls }),
			})(modelId);
		},
		defaultOptions: { store: false, reasoningSummary: 'auto' },
	},
	qwen: {
		...PROVIDER_META.qwen,
		create: (settings, modelId) => createCompatibleModel('qwen', settings, modelId),
	},
	minimax: {
		...PROVIDER_META.minimax,
		create: (settings, modelId) => createCompatibleModel('minimax', settings, modelId),
	},
	moonshot: {
		...PROVIDER_META.moonshot,
		create: (settings, modelId) => createCompatibleModel('moonshot', settings, modelId),
	},
	openaiCompatible: {
		...PROVIDER_META.openaiCompatible,
		create: (settings, modelId) => createCompatibleModel('openaiCompatible', settings, modelId),
	},
};

/**
 * Build a model for a provider that only exposes an OpenAI-compatible chat endpoint. Options keyed
 * under the provider id are forwarded as request body fields, which is how the vendor-specific
 * thinking switches reach the API.
 *
 * Without `supportsStructuredOutputs` the SDK drops the schema of a structured output call and asks
 * for a bare `json_object`, which the OpenAI API rejects unless a message spells out "json".
 */
function createCompatibleModel(provider: LlmProvider, settings: ProviderSettings, modelId: string): LanguageModelV3 {
	const baseURL = settings.baseURL || OPENAI_COMPATIBLE_BASE_URLS[providerKind(provider)];
	if (!baseURL) {
		throw new Error(`${providerLabel(provider)} needs a base URL: set one on the provider before using it`);
	}

	return createOpenAICompatible({
		name: provider,
		baseURL,
		apiKey: settings.apiKey,
		includeUsage: true,
		supportsStructuredOutputs: true,
	}).chatModel(modelId);
}

/** Named instances all speak the OpenAI-compatible API, so they skip their kind's own factory. */
function createModel(provider: LlmProvider, settings: ProviderSettings, modelId: string): LanguageModelV3 {
	return providerName(provider)
		? createCompatibleModel(provider, settings, modelId)
		: LLM_PROVIDERS[providerKind(provider)].create(settings, modelId);
}

export type ModelCallSettings = {
	temperature?: number;
	topP?: number;
	topK?: number;
	maxOutputTokens?: number;
};

/** Options the SDK forwards to a provider, keyed by the id the model reads them under. */
export type ProviderOptionsMap = Partial<{ [P in LlmProviderKind]: ProviderConfigMap[P] }> &
	Record<NamedLlmProvider, ProviderConfigMap[typeof NAMED_PROVIDER_KIND]>;

export type ProviderModelResult = {
	model: LanguageModelV3;
	providerOptions: ProviderOptionsMap;
	contextWindow: number;
	callSettings?: ModelCallSettings;
};

export function disableModelReasoning(provider: LlmProvider, modelResult: ProviderModelResult): ProviderModelResult {
	const optionKey =
		providerKind(provider) === 'vertex' && modelResult.model.modelId.startsWith('claude-') ? 'anthropic' : provider;
	const options = { ...(modelResult.providerOptions[optionKey] ?? {}) } as Record<string, unknown>;

	delete options.thinking;
	delete options.effort;
	delete options.reasoningConfig;
	delete options.thinkingConfig;
	delete options.reasoning;
	delete options.enable_thinking;
	delete options.reasoningEffort;
	delete options.reasoningSummary;
	delete options.sendReasoning;

	switch (providerKind(provider)) {
		case 'openai':
		case 'azure':
		case 'openaiCompatible':
			options.reasoningEffort = 'none';
			break;
		case 'openrouter':
			options.reasoning = { enabled: false };
			break;
		case 'qwen':
			options.enable_thinking = false;
			break;
	}

	return {
		...modelResult,
		providerOptions: {
			...modelResult.providerOptions,
			[optionKey]: options,
		} as ProviderOptionsMap,
	};
}

export function createProviderModel(
	provider: LlmProvider,
	settings: ProviderSettings,
	modelId: string,
	inferenceSettings?: ModelInferenceSettings,
): ProviderModelResult {
	const kind = providerKind(provider);
	const providerConfig = LLM_PROVIDERS[kind];
	const defaultOptions = resolveDefaultOptions(provider, modelId, providerConfig.defaultOptions ?? {});
	const modelConfig = getProviderModelConfig(kind, modelId);
	const contextWindow = providerConfig.models.find((m) => m.id === modelId)?.contextWindow ?? 200_000;

	const { callSettings, providerOverrides } = resolveInferenceOptions(provider, modelId, inferenceSettings);

	// Claude-on-Vertex keys provider options under `anthropic`, not `vertex`.
	const optionKey: LlmProvider = kind === 'vertex' && modelId.startsWith('claude-') ? 'anthropic' : provider;

	return {
		model: createModel(provider, settings, modelId),
		providerOptions: {
			[optionKey]: { ...defaultOptions, ...modelConfig, ...providerOverrides },
		} as ProviderOptionsMap,
		contextWindow,
		callSettings,
	};
}

function resolveDefaultOptions(provider: LlmProvider, modelId: string, defaultOptions: object): object {
	if (getModelCapabilities(provider, modelId)?.thinking !== 'none') {
		return defaultOptions;
	}
	const { reasoningSummary: _reasoningSummary, ...sampling } = defaultOptions as { reasoningSummary?: unknown };
	return sampling;
}

function resolveInferenceOptions(
	provider: LlmProvider,
	modelId: string,
	settings?: ModelInferenceSettings,
): { callSettings?: ModelCallSettings; providerOverrides?: Record<string, unknown> } {
	if (!settings) {
		return {};
	}

	const capabilities = getModelCapabilities(provider, modelId);
	const thinking = resolveThinking(provider, modelId, capabilities, settings);
	const extraOverrides = resolveExtraOptions(provider, modelId, capabilities, settings);
	const providerOverrides = mergeProviderOverrides(thinking.providerOverrides, extraOverrides);
	const thinkingActive = thinking.thinkingActive;

	const callSettings: ModelCallSettings = {};
	if (settings.maxOutputTokens !== undefined && capabilities?.maxOutputTokens !== false) {
		callSettings.maxOutputTokens = settings.maxOutputTokens;
	}

	const claudeApi = isAnthropicApiModel(provider, modelId);
	// Claude's Messages API rejects sampling params while thinking is active.
	const dropSampling = claudeApi && thinkingActive;
	if (capabilities?.sampling !== false && !dropSampling) {
		if (settings.temperature !== undefined) {
			const temperatureMax = capabilities?.temperatureMax ?? DEFAULT_TEMPERATURE_MAX;
			callSettings.temperature = clampNumber(settings.temperature, 0, temperatureMax);
		}
		if (settings.topP !== undefined) {
			callSettings.topP = clampNumber(settings.topP, 0, 1);
		}
		if (settings.topK !== undefined && capabilities?.topK !== false) {
			callSettings.topK = settings.topK;
		}
	}

	// Claude ignores topP when temperature is set, so drop it to match what's actually sent.
	if (claudeApi && callSettings.temperature !== undefined && callSettings.topP !== undefined) {
		delete callSettings.topP;
	}

	return {
		callSettings: Object.keys(callSettings).length > 0 ? callSettings : undefined,
		providerOverrides,
	};
}

function clampNumber(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/** Anthropic's minimum thinking budget; the API rejects anything lower. */
const MIN_THINKING_BUDGET = 1024;
/** Output tokens reserved for the visible answer when fitting a thinking budget under a limit. */
const THINKING_OUTPUT_RESERVE = 1024;

function fitBudget(budget: number, limit: number | undefined): number | undefined {
	if (limit === undefined) {
		return budget;
	}
	const fitted = Math.min(budget, limit - THINKING_OUTPUT_RESERVE);
	return fitted >= MIN_THINKING_BUDGET ? fitted : undefined;
}

/** Anthropic/Bedrock SDKs send max_tokens = maxOutputTokens + budgetTokens, so refit the budget under the call's max (dropping thinking if it would fall below the minimum). */
export function fitThinkingBudget(
	providerOptions: ProviderModelResult['providerOptions'],
	maxOutputTokens: number,
): ProviderModelResult['providerOptions'] {
	const fitted = { ...providerOptions };

	const anthropic = fitted.anthropic;
	const thinking = anthropic?.thinking;
	if (anthropic && thinking?.type === 'enabled' && thinking.budgetTokens !== undefined) {
		const budget = fitBudget(thinking.budgetTokens, maxOutputTokens);
		const rest = { ...anthropic };
		delete rest.thinking;
		fitted.anthropic =
			budget === undefined ? rest : { ...rest, thinking: { type: 'enabled', budgetTokens: budget } };
	}

	const bedrock = fitted.bedrock;
	const reasoning = bedrock?.reasoningConfig;
	if (bedrock && reasoning?.type === 'enabled' && reasoning.budgetTokens !== undefined) {
		const budget = fitBudget(reasoning.budgetTokens, maxOutputTokens);
		const rest = { ...bedrock };
		delete rest.reasoningConfig;
		fitted.bedrock =
			budget === undefined ? rest : { ...rest, reasoningConfig: { type: 'enabled', budgetTokens: budget } };
	}

	return fitted;
}

type ThinkingResult = { providerOverrides?: Record<string, unknown>; thinkingActive: boolean };

const THINKING_INACTIVE: ThinkingResult = { thinkingActive: false };

/** Snap a stored effort to the nearest option the model declares, so a stale setting can't error. */
function clampEffort(effort: ActiveEffort, options: ReasoningEffort[] | undefined): ActiveEffort {
	if (!options || options.includes(effort)) {
		return effort;
	}
	const candidates = options.filter((option): option is ActiveEffort => option !== 'off');
	if (candidates.length === 0) {
		return effort;
	}
	const target = EFFORT_OPTIONS.indexOf(effort);
	return candidates.reduce((best, candidate) => {
		const bestDistance = Math.abs(EFFORT_OPTIONS.indexOf(best) - target);
		const candidateDistance = Math.abs(EFFORT_OPTIONS.indexOf(candidate) - target);
		return candidateDistance < bestDistance ? candidate : best;
	});
}

function resolveThinking(
	provider: LlmProvider,
	modelId: string,
	capabilities: ModelCapabilities | undefined,
	settings: ModelInferenceSettings,
): ThinkingResult {
	const mode = capabilities?.thinking;
	if (mode === undefined || mode === 'none') {
		return THINKING_INACTIVE;
	}

	const stored = settings.reasoningEffort;
	const effort = stored && stored !== 'off' ? clampEffort(stored, capabilities?.effortOptions) : undefined;

	const kind = providerKind(provider);
	if (isAnthropicApiModel(provider, modelId)) {
		return kind === 'bedrock'
			? resolveClaudeThinking(
					capabilities,
					effort,
					settings,
					(e) => ({ reasoningConfig: { type: 'adaptive', maxReasoningEffort: EFFORT_TO_BEDROCK[e] } }),
					(b) => ({ reasoningConfig: { type: 'enabled', budgetTokens: b } }),
				)
			: resolveClaudeThinking(
					capabilities,
					effort,
					settings,
					(e) => ({ thinking: { type: 'adaptive' }, effort: EFFORT_TO_ANTHROPIC[e] }),
					(b) => ({ thinking: { type: 'enabled', budgetTokens: b } }),
				);
	}

	switch (kind) {
		case 'openai':
		case 'azure':
			return resolveEffortThinking(effort, (e) => ({
				reasoningEffort: (capabilities?.effortMap ?? EFFORT_TO_OPENAI)[e],
			}));
		case 'openrouter':
			return resolveEffortThinking(effort, (e) => ({
				reasoning: { enabled: true, effort: EFFORT_TO_OPENAI[e] },
			}));
		case 'google':
		case 'vertex':
			return resolveGeminiThinking(capabilities, effort, settings);
		case 'moonshot':
			// Kimi's own effort vocabulary, so the clamped value goes out as-is.
			return resolveEffortThinking(effort, (e) => ({ reasoningEffort: e }));
		case 'qwen':
			return resolveQwenThinking(capabilities, settings);
		case 'openaiCompatible':
			// The SDK turns this into the `reasoning_effort` field of the OpenAI chat API.
			return resolveEffortThinking(effort, (e) => ({ reasoningEffort: EFFORT_TO_OPENAI[e] }));
		default:
			return THINKING_INACTIVE;
	}
}

/** Qwen sizes thinking with a token budget, behind its own on/off switch. */
function resolveQwenThinking(
	capabilities: ModelCapabilities | undefined,
	settings: ModelInferenceSettings,
): ThinkingResult {
	if (capabilities?.thinking !== 'budget' || settings.thinkingBudgetTokens === undefined) {
		return THINKING_INACTIVE;
	}
	return {
		providerOverrides: { enable_thinking: true, thinking_budget: settings.thinkingBudgetTokens },
		thinkingActive: true,
	};
}

function resolveClaudeThinking(
	capabilities: ModelCapabilities | undefined,
	effort: ActiveEffort | undefined,
	settings: ModelInferenceSettings,
	adaptiveOverride: (effort: ActiveEffort) => Record<string, unknown>,
	budgetOverride: (budget: number) => Record<string, unknown>,
): ThinkingResult {
	if (capabilities?.thinking === 'adaptive' && effort) {
		return { providerOverrides: adaptiveOverride(effort), thinkingActive: true };
	}
	if (capabilities?.thinking === 'budget' && settings.thinkingBudgetTokens !== undefined) {
		const budget = fitBudget(settings.thinkingBudgetTokens, capabilities.maxOutputCap);
		if (budget === undefined) {
			return THINKING_INACTIVE;
		}
		return { providerOverrides: budgetOverride(budget), thinkingActive: true };
	}
	return THINKING_INACTIVE;
}

function resolveGeminiThinking(
	capabilities: ModelCapabilities | undefined,
	effort: ActiveEffort | undefined,
	settings: ModelInferenceSettings,
): ThinkingResult {
	if (capabilities?.thinking === 'adaptive' && effort) {
		return {
			providerOverrides: { thinkingConfig: { thinkingLevel: EFFORT_TO_GEMINI_LEVEL[effort] } },
			thinkingActive: true,
		};
	}
	if (capabilities?.thinking === 'budget' && settings.thinkingBudgetTokens !== undefined) {
		const range = capabilities.thinkingBudgetRange;
		const budget = range
			? clampNumber(settings.thinkingBudgetTokens, range.min, range.max)
			: settings.thinkingBudgetTokens;
		return {
			providerOverrides: { thinkingConfig: { thinkingBudget: budget } },
			thinkingActive: true,
		};
	}
	return THINKING_INACTIVE;
}

function resolveEffortThinking(
	effort: ActiveEffort | undefined,
	toOverrides: (effort: ActiveEffort) => Record<string, unknown>,
): ThinkingResult {
	if (!effort) {
		return THINKING_INACTIVE;
	}
	return { providerOverrides: toOverrides(effort), thinkingActive: true };
}

function resolveExtraOptions(
	provider: LlmProvider,
	modelId: string,
	capabilities: ModelCapabilities | undefined,
	settings: ModelInferenceSettings,
): Record<string, unknown> | undefined {
	const extraParams = capabilities?.extraParams;
	if (!extraParams?.length) {
		return undefined;
	}

	const overrides: Record<string, unknown> = {};
	for (const key of extraParams) {
		const value = settings[key];
		if (value === undefined) {
			continue;
		}
		if (key === 'parallelToolCalls' && isAnthropicApiModel(provider, modelId)) {
			overrides.disableParallelToolUse = !value;
		} else if (key === 'serviceTier' && providerKind(provider) === 'minimax') {
			// MiniMax options are forwarded verbatim, so the body field has to be named as the API expects.
			overrides.service_tier = value;
		} else if (key === 'includeThoughts') {
			overrides.thinkingConfig = { includeThoughts: value };
		} else if (key === 'safetyThreshold') {
			overrides.threshold = value;
		} else {
			overrides[key] = value;
		}
	}
	return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function mergeProviderOverrides(
	thinkingOverrides?: Record<string, unknown>,
	extraOverrides?: Record<string, unknown>,
): Record<string, unknown> | undefined {
	if (!thinkingOverrides || !extraOverrides) {
		return thinkingOverrides ?? extraOverrides;
	}
	const merged = { ...thinkingOverrides, ...extraOverrides };
	const a = thinkingOverrides.thinkingConfig;
	const b = extraOverrides.thinkingConfig;
	if (a && b && typeof a === 'object' && typeof b === 'object') {
		merged.thinkingConfig = { ...a, ...b };
	}
	return merged;
}

function getProviderModelConfig<P extends LlmProviderKind>(provider: P, modelId: string): ProviderConfigMap[P] {
	const model = LLM_PROVIDERS[provider].models.find((m) => m.id === modelId);
	return (model?.config ?? {}) as ProviderConfigMap[P];
}

function buildVertexAuthOptions(creds?: Record<string, string>) {
	const json = creds?.serviceAccountJson || process.env.VERTEX_GOOGLE_SERVICE_ACCOUNT_JSON;
	if (json) {
		try {
			const sa = JSON.parse(json);
			if (sa.client_email && sa.private_key) {
				return { credentials: { client_email: sa.client_email, private_key: sa.private_key } };
			}
		} catch {
			// fall through
		}
	}

	const keyFile = creds?.keyFile || process.env.VERTEX_GOOGLE_APPLICATION_CREDENTIALS;
	if (keyFile) {
		return { keyFile };
	}

	return undefined;
}

const BEDROCK_REGION_PREFIXES = new Set(['us', 'eu', 'ap']);
const BEDROCK_CROSS_REGION_PROVIDERS = new Set(['anthropic', 'meta']);

function getBedrockRegionPrefix(region: string): string {
	const geo = region.split('-')[0];
	return BEDROCK_REGION_PREFIXES.has(geo) ? geo : 'us';
}

function resolveBedrockModelId(modelId: string, region: string): string {
	const prefix = getBedrockRegionPrefix(region);
	const firstSegment = modelId.split('.')[0];
	if (BEDROCK_REGION_PREFIXES.has(firstSegment)) {
		const rest = modelId.slice(firstSegment.length + 1);
		return firstSegment === prefix ? modelId : `${prefix}.${rest}`;
	}
	if (BEDROCK_CROSS_REGION_PROVIDERS.has(firstSegment)) {
		return `${prefix}.${modelId}`;
	}
	return modelId;
}
