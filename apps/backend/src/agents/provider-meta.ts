import type { LlmProvider } from '@nao/shared/types';

import type { ProviderAuth, ProviderMetaMap } from '../types/llm';

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
				id: 'claude-sonnet-4-6',
				name: 'Claude Sonnet 4.6',
				default: true,
				contextWindow: 200_000,
				costPerM: { inputNoCache: 3, inputCacheRead: 0.3, inputCacheWrite: 3.75, output: 15 },
			},
			{
				id: 'claude-sonnet-4-5',
				name: 'Claude Sonnet 4.5',
				contextWindow: 200_000,
				costPerM: { inputNoCache: 3, inputCacheRead: 0.3, inputCacheWrite: 3.75, output: 15 },
			},
			{
				id: 'claude-opus-4-6',
				name: 'Claude Opus 4.6',
				contextWindow: 200_000,
				costPerM: { inputNoCache: 5, inputCacheRead: 0.5, inputCacheWrite: 6.25, output: 25 },
			},
			{
				id: 'claude-opus-4-5',
				name: 'Claude Opus 4.5',
				contextWindow: 200_000,
				costPerM: { inputNoCache: 5, inputCacheRead: 0.5, inputCacheWrite: 6.25, output: 25 },
			},
			{
				id: 'claude-haiku-4-5',
				name: 'Claude Haiku 4.5',
				contextWindow: 200_000,
				costPerM: { inputNoCache: 1, inputCacheRead: 0.1, inputCacheWrite: 1.25, output: 5 },
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
				id: 'gpt-5.4',
				name: 'GPT 5.4',
				default: true,
				contextWindow: 400_000,
				costPerM: { inputNoCache: 1.75, inputCacheRead: 0.175, inputCacheWrite: 0, output: 14 },
			},
			{
				id: 'gpt-5.2',
				name: 'GPT 5.2',
				contextWindow: 400_000,
				costPerM: { inputNoCache: 1.75, inputCacheRead: 0.175, inputCacheWrite: 0, output: 14 },
			},
			{
				id: 'gpt-5-mini',
				name: 'GPT 5 mini',
				contextWindow: 400_000,
				costPerM: { inputNoCache: 0.25, inputCacheRead: 0.025, inputCacheWrite: 0, output: 2 },
			},
			{
				id: 'gpt-4.1',
				name: 'GPT 4.1',
				contextWindow: 1_000_000,
				costPerM: { inputNoCache: 3, inputCacheRead: 0.75, inputCacheWrite: 0, output: 12 },
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
			{ id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', default: true, contextWindow: 1_000_000 },
			{ id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', contextWindow: 1_000_000 },
			{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1_000_000 },
			{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1_000_000 },
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
			},
			{
				id: 'mistral-large-latest',
				name: 'Mistral Large 3',
				contextWindow: 256_000,
				costPerM: { inputNoCache: 0.5, inputCacheRead: 0.5, inputCacheWrite: 0, output: 1.5 },
			},
			{
				id: 'labs-leanstral-2603',
				name: 'Leanstral',
				contextWindow: 256_000,
				costPerM: { inputNoCache: 0, inputCacheRead: 0, inputCacheWrite: 0, output: 0 },
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
			},
			{
				id: 'deepseek/deepseek-v3.2',
				name: 'DeepSeek V3.2',
				contextWindow: 163_800,
				costPerM: { inputNoCache: 0.26, inputCacheRead: 0.15, inputCacheWrite: 0, output: 0.4 },
			},
			{
				id: 'anthropic/claude-sonnet-4.5',
				name: 'Claude Sonnet 4.5 (OpenRouter)',
				contextWindow: 1_000_000,
				costPerM: { inputNoCache: 3, inputCacheRead: 0.3, inputCacheWrite: 3.75, output: 15 },
			},
			{
				id: 'openai/gpt-5.2',
				name: 'GPT 5.2 (OpenRouter)',
				contextWindow: 400_000,
				costPerM: { inputNoCache: 1.75, inputCacheRead: 0.175, inputCacheWrite: 0, output: 14 },
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
			{ id: 'qwen3:8b', name: 'Qwen 3 8B', default: true },
			{ id: 'llama3.2:3b', name: 'Llama 3.2 3B' },
			{ id: 'mistral:7b', name: 'Mistral 7B' },
		],
	},
	bedrock: {
		auth: {
			apiKey: 'optional',
			alternativeEnvVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
			hint: 'Optional — uses AWS credentials from environment if not provided',
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
			{ id: 'us.anthropic.claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Bedrock US)', default: true },
			{ id: 'eu.anthropic.claude-opus-4-6-v1', name: 'Claude Opus 4.6 (Bedrock EU)' },
			{ id: 'deepseek.v3.2', name: 'DeepSeek V3.2 (Bedrock)' },
			{ id: 'mistral.devstral-2-123b', name: 'Mistral 2 123B (Bedrock)' },
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
			{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Vertex)', default: true, contextWindow: 200_000 },
			{ id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Vertex)', contextWindow: 200_000 },
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
};

export function getDefaultModelId(provider: LlmProvider): string {
	const models = PROVIDER_META[provider].models;
	const defaultModel = models.find((m) => m.default);
	return defaultModel?.id ?? models[0]?.id ?? '';
}

export function getProviderAuth(provider: LlmProvider): ProviderAuth {
	return PROVIDER_META[provider].auth;
}

export function getProviderApiKeyRequirement(provider: LlmProvider): boolean {
	return PROVIDER_META[provider].auth.apiKey === 'required';
}

export const KNOWN_MODELS = Object.fromEntries(
	Object.entries(PROVIDER_META).map(([provider, config]) => [provider, config.models]),
) as { [K in LlmProvider]: (typeof PROVIDER_META)[K]['models'] };
