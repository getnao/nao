import { type LlmProvider, type LlmProviderKind, providerKind } from '@nao/shared/types';

import {
	type ActiveEffort,
	type ExtraParamKey,
	mediaResolutionSchema,
	type ModelCapabilities,
	type ParamControl,
	type ProviderAuth,
	type ProviderMetaMap,
	type ReasoningEffort,
	safetyThresholdSchema,
	type ServiceTier,
} from '../types/llm';

/**
 * Endpoints of the providers reached through a plain OpenAI-compatible chat API. The generic
 * provider is absent on purpose: it points at whatever endpoint the admin declares.
 */
export const OPENAI_COMPATIBLE_BASE_URLS: Partial<Record<LlmProviderKind, string>> = {
	qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
	minimax: 'https://api.minimax.io/v1',
	moonshot: 'https://api.moonshot.ai/v1',
};

/** Claude effort vocabulary: no `minimal` (Anthropic's effort enum is low/medium/high/max). */
const CLAUDE_EFFORTS: ReasoningEffort[] = ['off', 'low', 'medium', 'high', 'max'];
/** Listed GPT-5.x models: `minimal` passthrough, no `xhigh` (only specific models like Codex-Max take it). */
const OPENAI_LISTED_EFFORTS: ReasoningEffort[] = ['off', 'minimal', 'low', 'medium', 'high'];
/** Gemini 3.x Pro thinking levels: no `minimal` (rejected with a 400), no `max` (would alias high). */
const GEMINI_PRO_EFFORTS: ReasoningEffort[] = ['off', 'low', 'medium', 'high'];
/** Gemini 3.x Flash thinking levels: full minimal/low/medium/high range. */
const GEMINI_FLASH_EFFORTS: ReasoningEffort[] = ['off', 'minimal', 'low', 'medium', 'high'];
/** Custom/unlisted Gemini models: only low/high are accepted by every thinking-level model. */
const GEMINI_CUSTOM_EFFORTS: ReasoningEffort[] = ['off', 'low', 'high'];
/** GPT-5.6 dropped `minimal` and split the top of the scale, so `max` is a level above `xhigh`. */
const OPENAI_5_6_EFFORTS: ReasoningEffort[] = ['off', 'low', 'medium', 'high', 'max'];
/** Kimi K3 reasoning levels: the API accepts low/high/max only. */
const MOONSHOT_EFFORTS: ReasoningEffort[] = ['off', 'low', 'high', 'max'];

export const EFFORT_TO_OPENAI: Record<ActiveEffort, string> = {
	minimal: 'minimal',
	low: 'low',
	medium: 'medium',
	high: 'high',
	max: 'xhigh',
};

export const EFFORT_TO_OPENAI_5_6: Record<ActiveEffort, string> = { ...EFFORT_TO_OPENAI, minimal: 'low', max: 'max' };

export const EFFORT_TO_ANTHROPIC: Record<ActiveEffort, string> = {
	minimal: 'low',
	low: 'low',
	medium: 'medium',
	high: 'high',
	max: 'max',
};

export const EFFORT_TO_GEMINI_LEVEL: Record<ActiveEffort, string> = {
	minimal: 'minimal',
	low: 'low',
	medium: 'medium',
	high: 'high',
	max: 'high',
};

export const EFFORT_TO_BEDROCK: Record<ActiveEffort, string> = {
	minimal: 'low',
	low: 'low',
	medium: 'medium',
	high: 'high',
	max: 'max',
};

export const EFFORT_OPTIONS: ReasoningEffort[] = ['off', 'minimal', 'low', 'medium', 'high', 'max'];

const OPENAI_TIERS: ServiceTier[] = ['auto', 'default', 'flex', 'priority'];
const GOOGLE_TIERS: ServiceTier[] = ['standard', 'flex', 'priority'];
const BEDROCK_TIERS: ServiceTier[] = ['default', 'reserved', 'priority', 'flex'];
const MINIMAX_TIERS: ServiceTier[] = ['standard', 'priority'];

const ANTHROPIC_EXTRAS: ExtraParamKey[] = ['parallelToolCalls', 'sendReasoning', 'speed', 'inferenceGeo'];
/**
 * Claude on Vertex: `speed` (fast mode) and `inferenceGeo` are Anthropic-first-party request
 * fields that Vertex's endpoint rejects. `sendReasoning` is an SDK-side prompt transform and
 * `parallelToolCalls` maps to the Messages API `tool_choice.disable_parallel_tool_use` field,
 * both of which Vertex accepts.
 */
const VERTEX_ANTHROPIC_EXTRAS: ExtraParamKey[] = ['parallelToolCalls', 'sendReasoning'];
const OPENAI_REASONING_EXTRAS: ExtraParamKey[] = [
	'textVerbosity',
	'reasoningSummary',
	'parallelToolCalls',
	'maxToolCalls',
	'serviceTier',
];
const OPENAI_SAMPLING_EXTRAS: ExtraParamKey[] = ['parallelToolCalls', 'maxToolCalls', 'serviceTier'];
const GOOGLE_EXTRAS: ExtraParamKey[] = ['includeThoughts', 'safetyThreshold', 'mediaResolution', 'serviceTier'];
const MISTRAL_EXTRAS: ExtraParamKey[] = ['safePrompt', 'parallelToolCalls', 'documentImageLimit', 'documentPageLimit'];
const BEDROCK_EXTRAS: ExtraParamKey[] = ['serviceTier'];

/** Modern Claude (sonnet-4-6+/opus-4-6+/fable-5): adaptive thinking driven by effort; topK deprecated. */
const ANTHROPIC_ADAPTIVE: ModelCapabilities = {
	thinking: 'adaptive',
	sampling: true,
	topK: false,
	maxOutputTokens: true,
	effortOptions: CLAUDE_EFFORTS,
	temperatureMax: 1,
	extraParams: ANTHROPIC_EXTRAS,
};
/** Legacy Claude (4-5 era): extended thinking with an explicit token budget; still accepts topK. */
const ANTHROPIC_BUDGET: ModelCapabilities = {
	thinking: 'budget',
	sampling: true,
	topK: true,
	maxOutputTokens: true,
	temperatureMax: 1,
	extraParams: ANTHROPIC_EXTRAS,
	maxOutputCap: 64_000,
};

/** Claude on Vertex: adaptive thinking like direct Anthropic, minus the 1P-only extras. */
const VERTEX_ANTHROPIC_ADAPTIVE: ModelCapabilities = {
	...ANTHROPIC_ADAPTIVE,
	extraParams: VERTEX_ANTHROPIC_EXTRAS,
};

/** OpenAI/Azure reasoning models (GPT-5.x): effort-driven thinking; the API rejects sampling params. */
const OPENAI_REASONING: ModelCapabilities = {
	thinking: 'adaptive',
	sampling: false,
	topK: false,
	maxOutputTokens: true,
	effortOptions: OPENAI_LISTED_EFFORTS,
	extraParams: OPENAI_REASONING_EXTRAS,
	serviceTierOptions: OPENAI_TIERS,
};
/** Custom/unlisted OpenAI reasoning models: full effort surface incl. xhigh (e.g. Codex-Max variants). */
const OPENAI_REASONING_CUSTOM: ModelCapabilities = {
	...OPENAI_REASONING,
	effortOptions: undefined,
};
/** GPT-5.6 (Sol/Terra/Luna): same surface as GPT-5.x, on the wider none…max effort scale. */
const OPENAI_5_6_REASONING: ModelCapabilities = {
	...OPENAI_REASONING,
	effortOptions: OPENAI_5_6_EFFORTS,
	effortMap: EFFORT_TO_OPENAI_5_6,
};
/**
 * Custom Azure deployments: user-named, so nothing reveals whether they host a reasoning or a
 * sampling model. Offer both surfaces — params are only sent when explicitly configured.
 */
const AZURE_CUSTOM: ModelCapabilities = {
	...OPENAI_REASONING_CUSTOM,
	sampling: true,
};
/** OpenAI/Azure non-reasoning models (GPT-4.1): sampling only, no topK, no reasoning-related options. */
const OPENAI_SAMPLING: ModelCapabilities = {
	thinking: 'none',
	sampling: true,
	topK: false,
	maxOutputTokens: true,
	extraParams: OPENAI_SAMPLING_EXTRAS,
	serviceTierOptions: OPENAI_TIERS,
};

/** Gemini 3.x Pro: thinking driven by a discrete level (low/medium/high); full sampling incl. topK. */
const GOOGLE_LEVEL_PRO: ModelCapabilities = {
	thinking: 'adaptive',
	sampling: true,
	topK: true,
	maxOutputTokens: true,
	effortOptions: GEMINI_PRO_EFFORTS,
	extraParams: GOOGLE_EXTRAS,
	serviceTierOptions: GOOGLE_TIERS,
};
/** Gemini 3.x Flash: same as Pro but also accepts the `minimal` thinking level. */
const GOOGLE_LEVEL_FLASH: ModelCapabilities = {
	...GOOGLE_LEVEL_PRO,
	effortOptions: GEMINI_FLASH_EFFORTS,
};
/** Custom/unlisted Gemini models: restrict to the levels every thinking-level model accepts. */
const GOOGLE_LEVEL_CUSTOM: ModelCapabilities = {
	...GOOGLE_LEVEL_PRO,
	effortOptions: GEMINI_CUSTOM_EFFORTS,
};
/** Gemini 2.5: extended thinking with an explicit token budget; full sampling incl. topK. */
const GOOGLE_BUDGET: ModelCapabilities = {
	thinking: 'budget',
	sampling: true,
	topK: true,
	maxOutputTokens: true,
	extraParams: GOOGLE_EXTRAS,
	serviceTierOptions: GOOGLE_TIERS,
};
/** Gemini 2.5 Pro: the API rejects thinkingBudget values outside 128–32768. */
const GOOGLE_BUDGET_PRO: ModelCapabilities = {
	...GOOGLE_BUDGET,
	thinkingBudgetRange: { min: 128, max: 32_768 },
};
/** Gemini 2.5 Flash: the API rejects thinkingBudget values outside 0–24576. */
const GOOGLE_BUDGET_FLASH: ModelCapabilities = {
	...GOOGLE_BUDGET,
	thinkingBudgetRange: { min: 0, max: 24_576 },
};

/** Mistral chat models: sampling only (reasoning models would restrict effort to off/high). */
const MISTRAL_SAMPLING: ModelCapabilities = {
	thinking: 'none',
	sampling: true,
	topK: false,
	maxOutputTokens: true,
	// Mistral's chat completions API rejects temperatures above 1.5.
	temperatureMax: 1.5,
	extraParams: MISTRAL_EXTRAS,
};

/** OpenRouter: effort-driven reasoning normalized across models; sampling passes through incl. topK. */
const OPENROUTER_EFFORT: ModelCapabilities = {
	thinking: 'adaptive',
	sampling: true,
	topK: true,
	maxOutputTokens: true,
};

/** Bedrock Claude 4.6+: adaptive thinking driven by effort; topK deprecated. */
const BEDROCK_ADAPTIVE: ModelCapabilities = {
	thinking: 'adaptive',
	sampling: true,
	topK: false,
	maxOutputTokens: true,
	effortOptions: CLAUDE_EFFORTS,
	temperatureMax: 1,
	extraParams: BEDROCK_EXTRAS,
	serviceTierOptions: BEDROCK_TIERS,
};
/** Bedrock legacy Claude: extended thinking with an explicit token budget. */
const BEDROCK_BUDGET: ModelCapabilities = {
	thinking: 'budget',
	sampling: true,
	topK: true,
	maxOutputTokens: true,
	temperatureMax: 1,
	extraParams: BEDROCK_EXTRAS,
	serviceTierOptions: BEDROCK_TIERS,
	maxOutputCap: 64_000,
};
/** Bedrock non-Claude models (DeepSeek, Mistral): sampling only; the Converse API caps temperature at 1. */
const BEDROCK_SAMPLING: ModelCapabilities = {
	thinking: 'none',
	sampling: true,
	topK: false,
	maxOutputTokens: true,
	temperatureMax: 1,
	extraParams: BEDROCK_EXTRAS,
	serviceTierOptions: BEDROCK_TIERS,
};

/** Ollama local models: sampling + max output tokens (thinking is a model-creation setting, deferred). */
const OLLAMA_SAMPLING: ModelCapabilities = { thinking: 'none', sampling: true, topK: true, maxOutputTokens: true };

/**
 * Qwen hybrid-thinking models: thinking is sized by an explicit token budget. The OpenAI-compatible
 * chat endpoint drops topK for every provider it serves, so none of them expose it.
 */
const QWEN_BUDGET: ModelCapabilities = {
	thinking: 'budget',
	sampling: true,
	topK: false,
	maxOutputTokens: true,
};

/** MiniMax models: thinking is decided by the model itself, so only sampling and the tier are tunable. */
const MINIMAX_SAMPLING: ModelCapabilities = {
	thinking: 'none',
	sampling: true,
	topK: false,
	maxOutputTokens: true,
	extraParams: ['serviceTier'],
	serviceTierOptions: MINIMAX_TIERS,
};

/** Kimi K3: always reasons, with the intensity driven by effort. */
const MOONSHOT_ADAPTIVE: ModelCapabilities = {
	thinking: 'adaptive',
	sampling: true,
	topK: false,
	maxOutputTokens: true,
	effortOptions: MOONSHOT_EFFORTS,
	// Moonshot's chat completions API rejects temperatures above 1.
	temperatureMax: 1,
};

/** Kimi K2.x: thinking is a per-model switch rather than an effort, so only sampling is tunable. */
const MOONSHOT_SAMPLING: ModelCapabilities = {
	thinking: 'none',
	sampling: true,
	topK: false,
	maxOutputTokens: true,
	temperatureMax: 1,
};

/**
 * Models behind a user-declared OpenAI-compatible endpoint. Nothing says whether they reason or
 * only sample, so both surfaces are offered: every parameter is opt-in and only sent once the
 * admin sets it, and the effort levels stay within the vocabulary of the OpenAI chat API.
 */
const OPENAI_COMPATIBLE_CUSTOM: ModelCapabilities = {
	thinking: 'adaptive',
	sampling: true,
	topK: false,
	maxOutputTokens: true,
	effortOptions: OPENAI_LISTED_EFFORTS,
};

/** Provider metadata: models, auth config, env vars. No SDK imports — safe for frontend. */
export const PROVIDER_META: ProviderMetaMap = {
	anthropic: {
		auth: { apiKey: 'required' },
		envVar: 'ANTHROPIC_API_KEY',
		baseUrlEnvVar: 'ANTHROPIC_BASE_URL',
		extractorModelId: 'claude-haiku-4-5',
		summaryModelId: 'claude-sonnet-4-5',
		models: [
			{
				id: 'claude-fable-5',
				name: 'Claude Fable 5',
				contextWindow: 300_000,
				costPerM: { inputNoCache: 10, inputCacheRead: 1, inputCacheWrite: 12.5, output: 50 },
				capabilities: ANTHROPIC_ADAPTIVE,
			},
			{
				id: 'claude-opus-5',
				name: 'Claude Opus 5',
				contextWindow: 1_000_000,
				costPerM: { inputNoCache: 5, inputCacheRead: 0.5, inputCacheWrite: 6.25, output: 25 },
				capabilities: ANTHROPIC_ADAPTIVE,
			},
			{
				id: 'claude-opus-4-8',
				name: 'Claude Opus 4.8',
				contextWindow: 200_000,
				costPerM: { inputNoCache: 5, inputCacheRead: 0.5, inputCacheWrite: 6.25, output: 25 },
				capabilities: ANTHROPIC_ADAPTIVE,
			},
			{
				id: 'claude-opus-4-7',
				name: 'Claude Opus 4.7',
				contextWindow: 200_000,
				costPerM: { inputNoCache: 5, inputCacheRead: 0.5, inputCacheWrite: 6.25, output: 25 },
				capabilities: ANTHROPIC_ADAPTIVE,
			},
			{
				id: 'claude-sonnet-4-6',
				name: 'Claude Sonnet 4.6',
				default: true,
				contextWindow: 200_000,
				costPerM: { inputNoCache: 3, inputCacheRead: 0.3, inputCacheWrite: 3.75, output: 15 },
				capabilities: ANTHROPIC_ADAPTIVE,
			},
			{
				id: 'claude-sonnet-4-5',
				name: 'Claude Sonnet 4.5',
				contextWindow: 200_000,
				costPerM: { inputNoCache: 3, inputCacheRead: 0.3, inputCacheWrite: 3.75, output: 15 },
				capabilities: ANTHROPIC_BUDGET,
			},
			{
				id: 'claude-opus-4-6',
				name: 'Claude Opus 4.6',
				contextWindow: 200_000,
				costPerM: { inputNoCache: 5, inputCacheRead: 0.5, inputCacheWrite: 6.25, output: 25 },
				capabilities: ANTHROPIC_ADAPTIVE,
			},
			{
				id: 'claude-opus-4-5',
				name: 'Claude Opus 4.5',
				contextWindow: 200_000,
				costPerM: { inputNoCache: 5, inputCacheRead: 0.5, inputCacheWrite: 6.25, output: 25 },
				capabilities: ANTHROPIC_BUDGET,
			},
			{
				id: 'claude-haiku-4-5',
				name: 'Claude Haiku 4.5',
				contextWindow: 200_000,
				costPerM: { inputNoCache: 1, inputCacheRead: 0.1, inputCacheWrite: 1.25, output: 5 },
				capabilities: ANTHROPIC_BUDGET,
			},
		],
	},
	openai: {
		auth: { apiKey: 'required' },
		envVar: 'OPENAI_API_KEY',
		baseUrlEnvVar: 'OPENAI_BASE_URL',
		extractorModelId: 'gpt-4.1-mini',
		summaryModelId: 'gpt-4.1-mini',
		models: [
			{
				id: 'gpt-5.6-sol',
				name: 'GPT 5.6 Sol',
				contextWindow: 1_050_000,
				// GPT-5.6 is the first family to bill cache writes, at 1.25x the uncached input rate.
				costPerM: { inputNoCache: 5, inputCacheRead: 0.5, inputCacheWrite: 6.25, output: 30 },
				capabilities: OPENAI_5_6_REASONING,
			},
			{
				id: 'gpt-5.6-terra',
				name: 'GPT 5.6 Terra',
				contextWindow: 1_050_000,
				costPerM: { inputNoCache: 2, inputCacheRead: 0.2, inputCacheWrite: 2.5, output: 12 },
				capabilities: OPENAI_5_6_REASONING,
			},
			{
				id: 'gpt-5.6-luna',
				name: 'GPT 5.6 Luna',
				contextWindow: 1_050_000,
				costPerM: { inputNoCache: 0.2, inputCacheRead: 0.02, inputCacheWrite: 0.25, output: 1.2 },
				capabilities: OPENAI_5_6_REASONING,
			},
			{
				id: 'gpt-5.5',
				name: 'GPT 5.5',
				default: true,
				contextWindow: 400_000,
				costPerM: { inputNoCache: 5, inputCacheRead: 0.5, inputCacheWrite: 0, output: 30 },
				capabilities: OPENAI_REASONING,
			},
			{
				id: 'gpt-5.4',
				name: 'GPT 5.4',
				contextWindow: 400_000,
				costPerM: { inputNoCache: 2.5, inputCacheRead: 0.25, inputCacheWrite: 0, output: 15 },
				capabilities: OPENAI_REASONING,
			},
			{
				id: 'gpt-5.2',
				name: 'GPT 5.2',
				contextWindow: 400_000,
				costPerM: { inputNoCache: 1.75, inputCacheRead: 0.175, inputCacheWrite: 0, output: 14 },
				capabilities: OPENAI_REASONING,
			},
			{
				id: 'gpt-5-mini',
				name: 'GPT 5 mini',
				contextWindow: 400_000,
				costPerM: { inputNoCache: 0.25, inputCacheRead: 0.025, inputCacheWrite: 0, output: 2 },
				capabilities: OPENAI_REASONING,
			},
			{
				id: 'gpt-4.1',
				name: 'GPT 4.1',
				contextWindow: 1_000_000,
				costPerM: { inputNoCache: 3, inputCacheRead: 0.75, inputCacheWrite: 0, output: 12 },
				capabilities: OPENAI_SAMPLING,
			},
		],
	},
	google: {
		auth: { apiKey: 'required' },
		envVar: 'GEMINI_API_KEY',
		baseUrlEnvVar: 'GEMINI_BASE_URL',
		extractorModelId: 'gemini-2.5-flash',
		summaryModelId: 'gemini-2.5-flash',
		models: [
			{
				id: 'gemini-3.1-pro-preview',
				name: 'Gemini 3.1 Pro',
				default: true,
				contextWindow: 1_000_000,
				costPerM: { inputNoCache: 2, inputCacheRead: 0.2, inputCacheWrite: 0, output: 12 },
				capabilities: GOOGLE_LEVEL_PRO,
			},
			{
				id: 'gemini-3-flash-preview',
				name: 'Gemini 3 Flash',
				contextWindow: 1_000_000,
				costPerM: { inputNoCache: 0.5, inputCacheRead: 0.05, inputCacheWrite: 0, output: 3 },
				capabilities: GOOGLE_LEVEL_FLASH,
			},
			{
				id: 'gemini-2.5-pro',
				name: 'Gemini 2.5 Pro',
				contextWindow: 1_000_000,
				costPerM: { inputNoCache: 1.25, inputCacheRead: 0.125, inputCacheWrite: 0, output: 10 },
				capabilities: GOOGLE_BUDGET_PRO,
			},
			{
				id: 'gemini-2.5-flash',
				name: 'Gemini 2.5 Flash',
				contextWindow: 1_000_000,
				costPerM: { inputNoCache: 0.3, inputCacheRead: 0.03, inputCacheWrite: 0, output: 2.5 },
				capabilities: GOOGLE_BUDGET_FLASH,
			},
		],
	},
	mistral: {
		auth: { apiKey: 'required' },
		envVar: 'MISTRAL_API_KEY',
		baseUrlEnvVar: 'MISTRAL_BASE_URL',
		extractorModelId: 'mistral-medium-latest',
		summaryModelId: 'mistral-medium-latest',
		models: [
			{
				id: 'mistral-medium-latest',
				name: 'Mistral Medium 3.1',
				default: true,
				contextWindow: 128_000,
				costPerM: { inputNoCache: 0.4, inputCacheRead: 0.4, inputCacheWrite: 0, output: 2 },
				capabilities: MISTRAL_SAMPLING,
			},
			{
				id: 'mistral-large-latest',
				name: 'Mistral Large 3',
				contextWindow: 256_000,
				costPerM: { inputNoCache: 0.5, inputCacheRead: 0.5, inputCacheWrite: 0, output: 1.5 },
				capabilities: MISTRAL_SAMPLING,
			},
			{
				id: 'labs-leanstral-2603',
				name: 'Leanstral',
				contextWindow: 256_000,
				costPerM: { inputNoCache: 0, inputCacheRead: 0, inputCacheWrite: 0, output: 0 },
				capabilities: MISTRAL_SAMPLING,
			},
		],
	},
	openrouter: {
		auth: { apiKey: 'required' },
		envVar: 'OPENROUTER_API_KEY',
		baseUrlEnvVar: 'OPENROUTER_BASE_URL',
		extractorModelId: 'anthropic/claude-haiku-4.5',
		summaryModelId: 'anthropic/claude-haiku-4.5',
		models: [
			{
				id: 'moonshotai/kimi-k2.5',
				name: 'Kimi K2.5',
				default: true,
				contextWindow: 262_144,
				costPerM: { inputNoCache: 0.5, inputCacheRead: 0.8, inputCacheWrite: 0, output: 2.25 },
				capabilities: OPENROUTER_EFFORT,
			},
			{
				id: 'deepseek/deepseek-v3.2',
				name: 'DeepSeek V3.2',
				contextWindow: 163_800,
				costPerM: { inputNoCache: 0.26, inputCacheRead: 0.15, inputCacheWrite: 0, output: 0.4 },
				capabilities: OPENROUTER_EFFORT,
			},
			{
				id: 'anthropic/claude-sonnet-4.5',
				name: 'Claude Sonnet 4.5 (OpenRouter)',
				contextWindow: 1_000_000,
				costPerM: { inputNoCache: 3, inputCacheRead: 0.3, inputCacheWrite: 3.75, output: 15 },
				capabilities: OPENROUTER_EFFORT,
			},
			{
				id: 'openai/gpt-5.2',
				name: 'GPT 5.2 (OpenRouter)',
				contextWindow: 400_000,
				costPerM: { inputNoCache: 1.75, inputCacheRead: 0.175, inputCacheWrite: 0, output: 14 },
				capabilities: OPENROUTER_EFFORT,
			},
		],
	},
	ollama: {
		auth: { apiKey: 'none' },
		envVar: 'OLLAMA_API_KEY',
		baseUrlEnvVar: 'OLLAMA_BASE_URL',
		extractorModelId: 'llama3.2:3b',
		summaryModelId: 'llama3.2:3b',
		models: [
			{ id: 'qwen3:8b', name: 'Qwen 3 8B', default: true, capabilities: OLLAMA_SAMPLING },
			{ id: 'llama3.2:3b', name: 'Llama 3.2 3B', capabilities: OLLAMA_SAMPLING },
			{ id: 'mistral:7b', name: 'Mistral 7B', capabilities: OLLAMA_SAMPLING },
		],
	},
	bedrock: {
		auth: {
			apiKey: 'optional',
			// Any one satisfied bundle is enough. First bundle is static IAM creds
			// (access key + secret, both required). The rest are ambient signals
			// resolved by the AWS SDK chain: ECS task role, EKS IRSA, named profile,
			// or an explicit AWS_USE_INSTANCE_CREDENTIALS=1 opt-in for EC2 instance
			// profiles / default shared-credentials profile (no env footprint).
			alternativeEnvVars: [
				['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
				['AWS_PROFILE'],
				['AWS_CONTAINER_CREDENTIALS_RELATIVE_URI'],
				['AWS_CONTAINER_CREDENTIALS_FULL_URI'],
				['AWS_WEB_IDENTITY_TOKEN_FILE'],
				['AWS_SDK_LOAD_CONFIG'],
				['AWS_USE_INSTANCE_CREDENTIALS'],
			],
			hint: 'Optional — leave empty to use AWS credentials from environment, IAM task role, IRSA, or instance profile',
			extraFields: [
				{ name: 'region', label: 'AWS Region', envVar: 'AWS_REGION', placeholder: 'us-east-1' },
				{ name: 'accessKeyId', label: 'Access Key ID', envVar: 'AWS_ACCESS_KEY_ID' },
				{ name: 'secretAccessKey', label: 'Secret Access Key', envVar: 'AWS_SECRET_ACCESS_KEY', secret: true },
			],
		},
		envVar: 'AWS_BEARER_TOKEN_BEDROCK',
		extractorModelId: 'anthropic.claude-sonnet-4-6',
		summaryModelId: 'anthropic.claude-sonnet-4-6',
		models: [
			{
				id: 'us.anthropic.claude-sonnet-4-6',
				name: 'Claude Sonnet 4.6 (Bedrock US)',
				default: true,
				costPerM: { inputNoCache: 3, inputCacheRead: 0.3, inputCacheWrite: 3.75, output: 15 },
				capabilities: BEDROCK_ADAPTIVE,
			},
			{
				id: 'eu.anthropic.claude-opus-4-6-v1',
				name: 'Claude Opus 4.6 (Bedrock EU)',
				costPerM: { inputNoCache: 5, inputCacheRead: 0.5, inputCacheWrite: 6.25, output: 25 },
				capabilities: BEDROCK_ADAPTIVE,
			},
			{
				id: 'deepseek.v3.2',
				name: 'DeepSeek V3.2 (Bedrock)',
				costPerM: { inputNoCache: 0.62, inputCacheRead: 0.62, inputCacheWrite: 0, output: 1.85 },
				capabilities: BEDROCK_SAMPLING,
			},
			{
				id: 'mistral.devstral-2-123b',
				name: 'Mistral 2 123B (Bedrock)',
				costPerM: { inputNoCache: 0.4, inputCacheRead: 0.4, inputCacheWrite: 0, output: 2 },
				capabilities: BEDROCK_SAMPLING,
			},
		],
	},
	vertex: {
		auth: {
			apiKey: 'none',
			extraFields: [
				{
					name: 'project',
					label: 'GCP Project',
					envVar: 'GOOGLE_VERTEX_PROJECT',
					placeholder: 'my-gcp-project',
				},
				{ name: 'location', label: 'GCP Location', envVar: 'GOOGLE_VERTEX_LOCATION', placeholder: 'us-east5' },
				{
					name: 'serviceAccountJson',
					label: 'Service Account JSON',
					envVar: 'VERTEX_GOOGLE_SERVICE_ACCOUNT_JSON',
					placeholder:
						'{"client_email": "sa@project.iam.gserviceaccount.com", "private_key": "-----BEGIN PRIVATE KEY-----..."}',
					secret: true,
					multiline: true,
				},
				{
					name: 'keyFile',
					label: 'Key File Path',
					envVar: 'VERTEX_GOOGLE_APPLICATION_CREDENTIALS',
					placeholder: '/path/to/service-account.json',
				},
			],
		},
		envVar: 'VERTEX_GOOGLE_SERVICE_ACCOUNT_JSON',
		extractorModelId: 'gemini-2.5-flash',
		summaryModelId: 'gemini-2.5-flash',
		models: [
			{
				id: 'claude-sonnet-4-6',
				name: 'Claude Sonnet 4.6 (Vertex)',
				default: true,
				contextWindow: 200_000,
				costPerM: { inputNoCache: 3, inputCacheRead: 0.3, inputCacheWrite: 3.75, output: 15 },
			},
			{
				id: 'gemini-3-flash-preview',
				name: 'Gemini 3 Flash (Vertex)',
				contextWindow: 200_000,
				costPerM: { inputNoCache: 0.5, inputCacheRead: 0.05, inputCacheWrite: 0, output: 3 },
				capabilities: GOOGLE_LEVEL_FLASH,
			},
		],
	},
	azure: {
		auth: {
			apiKey: 'required',
			hint: 'Provide either a Resource Name or a Base URL — not both',
			extraFields: [
				{
					name: 'resourceName',
					label: 'Resource Name',
					envVar: 'AZURE_RESOURCE_NAME',
					placeholder: 'my-resource (builds https://{name}.openai.azure.com)',
				},
				{
					name: 'apiVersion',
					label: 'API Version',
					envVar: 'AZURE_API_VERSION',
					placeholder: 'v1',
				},
				{
					name: 'useDeploymentBasedUrls',
					label: 'Use Deployment-Based URLs',
					envVar: 'AZURE_USE_DEPLOYMENT_BASED_URLS',
					placeholder: 'false',
				},
			],
		},
		envVar: 'AZURE_API_KEY',
		baseUrlEnvVar: 'AZURE_OPENAI_BASE_URL',
		extractorModelId: '',
		summaryModelId: '',
		models: [],
	},
	qwen: {
		auth: {
			apiKey: 'required',
			hint: 'Model Studio keys are regional — set a base URL to reach an endpoint other than Singapore',
		},
		envVar: 'DASHSCOPE_API_KEY',
		baseUrlEnvVar: 'DASHSCOPE_BASE_URL',
		defaultBaseUrl: OPENAI_COMPATIBLE_BASE_URLS.qwen,
		extractorModelId: 'qwen3.7-flash',
		summaryModelId: 'qwen3.7-flash',
		models: [
			{
				id: 'qwen3.7-plus',
				name: 'Qwen3.7 Plus',
				default: true,
				contextWindow: 1_000_000,
				costPerM: { inputNoCache: 0.4, inputCacheRead: 0.4, inputCacheWrite: 0, output: 1.6 },
				capabilities: QWEN_BUDGET,
			},
			{
				id: 'qwen3.7-max',
				name: 'Qwen3.7 Max',
				contextWindow: 1_000_000,
				costPerM: { inputNoCache: 2.5, inputCacheRead: 2.5, inputCacheWrite: 0, output: 7.5 },
				capabilities: QWEN_BUDGET,
			},
			{
				id: 'qwen3.7-flash',
				name: 'Qwen3.7 Flash',
				contextWindow: 1_000_000,
				costPerM: { inputNoCache: 0.225, inputCacheRead: 0.225, inputCacheWrite: 0, output: 0.974 },
				capabilities: QWEN_BUDGET,
			},
		],
	},
	minimax: {
		auth: { apiKey: 'required' },
		envVar: 'MINIMAX_API_KEY',
		baseUrlEnvVar: 'MINIMAX_BASE_URL',
		defaultBaseUrl: OPENAI_COMPATIBLE_BASE_URLS.minimax,
		extractorModelId: 'MiniMax-M2.7',
		summaryModelId: 'MiniMax-M2.7',
		models: [
			{
				id: 'MiniMax-M3',
				name: 'MiniMax M3',
				default: true,
				contextWindow: 1_000_000,
				costPerM: { inputNoCache: 0.3, inputCacheRead: 0.06, inputCacheWrite: 0, output: 1.2 },
				capabilities: MINIMAX_SAMPLING,
			},
			{
				id: 'MiniMax-M2.7',
				name: 'MiniMax M2.7',
				contextWindow: 204_800,
				costPerM: { inputNoCache: 0.3, inputCacheRead: 0.06, inputCacheWrite: 0.375, output: 1.2 },
				capabilities: MINIMAX_SAMPLING,
			},
			{
				id: 'MiniMax-M2.7-highspeed',
				name: 'MiniMax M2.7 Highspeed',
				contextWindow: 204_800,
				costPerM: { inputNoCache: 0.6, inputCacheRead: 0.06, inputCacheWrite: 0.375, output: 2.4 },
				capabilities: MINIMAX_SAMPLING,
			},
		],
	},
	moonshot: {
		auth: { apiKey: 'required' },
		envVar: 'MOONSHOT_API_KEY',
		baseUrlEnvVar: 'MOONSHOT_BASE_URL',
		defaultBaseUrl: OPENAI_COMPATIBLE_BASE_URLS.moonshot,
		extractorModelId: 'kimi-k2.5',
		summaryModelId: 'kimi-k2.5',
		models: [
			{
				id: 'kimi-k3',
				name: 'Kimi K3',
				default: true,
				contextWindow: 1_048_576,
				costPerM: { inputNoCache: 3, inputCacheRead: 0.3, inputCacheWrite: 0, output: 15 },
				capabilities: MOONSHOT_ADAPTIVE,
			},
			{
				id: 'kimi-k2.7-code',
				name: 'Kimi K2.7 Code',
				contextWindow: 262_144,
				costPerM: { inputNoCache: 0.95, inputCacheRead: 0.19, inputCacheWrite: 0, output: 4 },
				capabilities: MOONSHOT_SAMPLING,
			},
			{
				id: 'kimi-k2.6',
				name: 'Kimi K2.6',
				contextWindow: 262_144,
				costPerM: { inputNoCache: 0.95, inputCacheRead: 0.16, inputCacheWrite: 0, output: 4 },
				capabilities: MOONSHOT_SAMPLING,
			},
			{
				id: 'kimi-k2.5',
				name: 'Kimi K2.5',
				contextWindow: 262_144,
				costPerM: { inputNoCache: 0.6, inputCacheRead: 0.1, inputCacheWrite: 0, output: 3 },
				capabilities: MOONSHOT_SAMPLING,
			},
		],
	},
	openaiCompatible: {
		auth: {
			apiKey: 'optional',
			hint: 'Optional — leave empty for endpoints that need no authentication, such as a local server',
			// The endpoint alone is enough to reach a server that needs no key.
			alternativeEnvVars: [['OPENAI_COMPATIBLE_BASE_URL']],
		},
		envVar: 'OPENAI_COMPATIBLE_API_KEY',
		baseUrlEnvVar: 'OPENAI_COMPATIBLE_BASE_URL',
		requiresBaseUrl: true,
		extractorModelId: '',
		summaryModelId: '',
		models: [],
	},
};

/** The metadata of the integration behind a provider, shared by every instance of that kind. */
export function getProviderMeta(provider: LlmProvider): ProviderMetaMap[LlmProviderKind] {
	return PROVIDER_META[providerKind(provider)];
}

export function getDefaultModelId(provider: LlmProvider): string {
	const models = getProviderMeta(provider).models;
	const defaultModel = models.find((m) => m.default);
	return defaultModel?.id ?? models[0]?.id ?? '';
}

export function getProviderAuth(provider: LlmProvider): ProviderAuth {
	return getProviderMeta(provider).auth;
}

export function getProviderApiKeyRequirement(provider: LlmProvider): boolean {
	return getProviderAuth(provider).apiKey === 'required';
}

export const KNOWN_MODELS = Object.fromEntries(
	Object.entries(PROVIDER_META).map(([provider, config]) => [provider, config.models]),
) as { [K in LlmProviderKind]: (typeof PROVIDER_META)[K]['models'] };

/**
 * Whether a model is served through Anthropic's Messages API (directly, or Claude on Vertex/Bedrock).
 * These share the sampling constraints: topP is ignored when temperature is set and all sampling
 * params are rejected while thinking is active.
 */
export function isAnthropicApiModel(provider: LlmProvider, modelId: string): boolean {
	switch (providerKind(provider)) {
		case 'anthropic':
			return true;
		case 'vertex':
			return modelId.startsWith('claude-');
		case 'bedrock':
			return modelId.includes('claude');
		default:
			return false;
	}
}

/**
 * Resolve the tunable-parameter capabilities for a model. Falls back to sensible per-provider
 * defaults for custom (unlisted) models so tuning still works for user-added model ids.
 */
export function getModelCapabilities(provider: LlmProvider, modelId: string): ModelCapabilities | undefined {
	const known = getProviderMeta(provider).models.find((m) => m.id === modelId);
	if (known?.capabilities) {
		return known.capabilities;
	}
	switch (providerKind(provider)) {
		case 'anthropic':
			return ANTHROPIC_ADAPTIVE;
		case 'openai':
			return OPENAI_REASONING_CUSTOM;
		case 'azure':
			return AZURE_CUSTOM;
		case 'google':
			return GOOGLE_LEVEL_CUSTOM;
		case 'vertex':
			return modelId.startsWith('claude-') ? VERTEX_ANTHROPIC_ADAPTIVE : GOOGLE_LEVEL_CUSTOM;
		case 'openrouter':
			return OPENROUTER_EFFORT;
		case 'mistral':
			return MISTRAL_SAMPLING;
		case 'ollama':
			return OLLAMA_SAMPLING;
		case 'bedrock':
			// Custom Claude ids default to budget-based thinking (supported across all Claude
			// versions); adaptive+effort only exists on 4.6+, so it stays opt-in via known models.
			return modelId.includes('claude') ? BEDROCK_BUDGET : BEDROCK_SAMPLING;
		case 'qwen':
			return QWEN_BUDGET;
		case 'minimax':
			return MINIMAX_SAMPLING;
		case 'moonshot':
			return MOONSHOT_ADAPTIVE;
		case 'openaiCompatible':
			return OPENAI_COMPATIBLE_CUSTOM;
		default:
			return undefined;
	}
}

/** Temperature upper bound when a model's capabilities don't declare one. */
export const DEFAULT_TEMPERATURE_MAX = 2;

/**
 * Ordered list of editable inference-parameter controls for a model, derived from its
 * capabilities. Drives the settings UI (render exactly this list, nothing hardcoded).
 */
export function getModelParameterSpec(provider: LlmProvider, modelId: string): ParamControl[] {
	const caps = getModelCapabilities(provider, modelId);
	if (!caps) {
		return [];
	}

	const controls: ParamControl[] = [];

	if (caps.thinking === 'adaptive') {
		controls.push({
			key: 'reasoningEffort',
			kind: 'effort',
			label: 'Thinking effort',
			options: caps.effortOptions ?? EFFORT_OPTIONS,
		});
	} else if (caps.thinking === 'budget') {
		const range = caps.thinkingBudgetRange;
		controls.push({
			key: 'thinkingBudgetTokens',
			kind: 'number',
			label: 'Thinking budget (tokens)',
			placeholder: 'e.g. 8000',
			step: 1024,
			integer: true,
			// The stored-settings schema floors the budget at 1024 even when the API range starts lower.
			min: Math.max(1024, range?.min ?? 1024),
			...(range && { max: range.max }),
			...(isAnthropicApiModel(provider, modelId) && { lessThan: 'maxOutputTokens' as const }),
		});
	}

	if (caps.sampling) {
		// Claude (direct or on Vertex/Bedrock) treats topP as mutually exclusive with
		// temperature and drops all sampling params while thinking is active.
		const isClaude = isAnthropicApiModel(provider, modelId);
		const temperatureMax = caps.temperatureMax ?? DEFAULT_TEMPERATURE_MAX;
		controls.push(
			{
				key: 'temperature',
				kind: 'number',
				label: 'Temperature',
				placeholder: `0 – ${temperatureMax}`,
				step: 0.1,
				min: 0,
				max: temperatureMax,
				...(isClaude && { group: 'sampling' as const }),
			},
			{
				key: 'topP',
				kind: 'number',
				label: 'Top P',
				placeholder: '0 – 1',
				step: 0.05,
				min: 0,
				max: 1,
				...(isClaude && { group: 'sampling' as const, exclusiveWith: 'temperature' as const }),
			},
		);
		if (caps.topK) {
			controls.push({
				key: 'topK',
				kind: 'number',
				label: 'Top K',
				placeholder: 'e.g. 40',
				step: 1,
				min: 1,
				integer: true,
				...(isClaude && { group: 'sampling' as const }),
			});
		}
	}

	if (caps.maxOutputTokens) {
		controls.push({
			key: 'maxOutputTokens',
			kind: 'number',
			label: 'Max output tokens',
			placeholder: 'e.g. 16000',
			step: 1,
			min: 1,
			integer: true,
		});
	}

	for (const key of caps.extraParams ?? []) {
		controls.push(buildExtraParamControl(key, caps));
	}

	return controls;
}

function buildExtraParamControl(key: ExtraParamKey, caps: ModelCapabilities): ParamControl {
	switch (key) {
		case 'textVerbosity':
			return { key, kind: 'select', label: 'Text verbosity', options: ['low', 'medium', 'high'] };
		case 'reasoningSummary':
			return { key, kind: 'select', label: 'Reasoning summary', options: ['auto', 'detailed'] };
		case 'parallelToolCalls':
			return { key, kind: 'boolean', label: 'Parallel tool calls' };
		case 'maxToolCalls':
			return {
				key,
				kind: 'number',
				label: 'Max tool calls',
				placeholder: 'e.g. 20',
				step: 1,
				min: 1,
				integer: true,
			};
		case 'serviceTier':
			return { key, kind: 'select', label: 'Service tier', options: caps.serviceTierOptions ?? [] };
		case 'speed':
			return { key, kind: 'select', label: 'Speed', options: ['standard', 'fast'] };
		case 'inferenceGeo':
			return { key, kind: 'select', label: 'Inference geography', options: ['us', 'global'] };
		case 'sendReasoning':
			return { key, kind: 'boolean', label: 'Send reasoning back' };
		case 'includeThoughts':
			return { key, kind: 'boolean', label: 'Include thoughts' };
		case 'safetyThreshold':
			return { key, kind: 'select', label: 'Safety threshold', options: safetyThresholdSchema.options };
		case 'mediaResolution':
			return { key, kind: 'select', label: 'Media resolution', options: mediaResolutionSchema.options };
		case 'safePrompt':
			return { key, kind: 'boolean', label: 'Safe prompt' };
		case 'documentImageLimit':
			return {
				key,
				kind: 'number',
				label: 'Document image limit',
				placeholder: 'e.g. 8',
				step: 1,
				min: 1,
				integer: true,
			};
		case 'documentPageLimit':
			return {
				key,
				kind: 'number',
				label: 'Document page limit',
				placeholder: 'e.g. 64',
				step: 1,
				min: 1,
				integer: true,
			};
	}
}
