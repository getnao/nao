import type { LlmProvider, LlmSelectedModel } from '@nao/shared/types';

import { createProviderModel, getDefaultModelId, LLM_PROVIDERS, type ProviderModelResult } from '../agents/providers';
import * as projectQueries from '../queries/project.queries';
import * as projectLlmConfigQueries from '../queries/project-llm-config.queries';
import type { CustomModelMetadata, ProviderSettings } from '../types/llm';
import { type ConfigLlm, type ConfigLlmProvider, findConfigLlmProvider, readProjectConfigLlm } from './nao-config-llm';

export { getDefaultModelId };

/** Get the API key from environment for a provider */
export function getEnvApiKey(provider: LlmProvider): string | undefined {
	return process.env[LLM_PROVIDERS[provider].envVar];
}

/** Get the base URL from environment for a provider (e.g. OPENAI_BASE_URL) */
export function getEnvBaseUrl(provider: LlmProvider): string | undefined {
	const { baseUrlEnvVar } = LLM_PROVIDERS[provider];
	return baseUrlEnvVar ? process.env[baseUrlEnvVar] : undefined;
}

/** Check if a provider has authentication configured via environment */
export function hasEnvApiKey(provider: LlmProvider): boolean {
	if (getEnvApiKey(provider)) {
		return true;
	}
	const { alternativeEnvVars, extraFields, apiKey } = LLM_PROVIDERS[provider].auth;
	if (alternativeEnvVars?.some((bundle) => bundle.every((v) => process.env[v]))) {
		return true;
	}
	// For providers that don't require an API key (e.g. Vertex), check if any extra field env var is set
	if (apiKey === 'none' && extraFields?.some((f) => process.env[f.envVar])) {
		return true;
	}
	return false;
}

/** Get all providers that have API keys configured via environment */
export function getEnvProviders(): LlmProvider[] {
	return (Object.keys(LLM_PROVIDERS) as LlmProvider[]).filter(hasEnvApiKey);
}

/** Get base URLs set via environment, keyed by provider */
export function getEnvBaseUrls(): Record<string, string> {
	return Object.fromEntries(
		getEnvProviders()
			.map((p) => [p, getEnvBaseUrl(p)] as const)
			.filter((entry): entry is [LlmProvider, string] => !!entry[1]),
	);
}

/** Get the first available provider from env (preferring anthropic) */
export function getDefaultEnvProvider(): LlmProvider | undefined {
	if (hasEnvApiKey('anthropic')) {
		return 'anthropic';
	}
	if (hasEnvApiKey('openai')) {
		return 'openai';
	}
	return undefined;
}

/** Check if a model ID is known for a provider */
export function isKnownModel(provider: LlmProvider, modelId: string): boolean {
	return LLM_PROVIDERS[provider].models.some((m) => m.id === modelId);
}

/** Get all known model IDs for a provider */
export function getKnownModelIds(provider: LlmProvider): string[] {
	return LLM_PROVIDERS[provider].models.map((m) => m.id);
}

/** Get model selections for all env-configured providers */
export function getEnvModelSelections(): LlmSelectedModel[] {
	return getEnvProviders().map((provider) => ({
		provider,
		modelId: getDefaultModelId(provider),
	}));
}

/** Resolve API key + base URL for a provider from DB config, nao_config.yaml or env vars. */
export async function resolveProviderSettings(
	projectId: string,
	provider: LlmProvider,
): Promise<ProviderSettings | null> {
	const config = await projectLlmConfigQueries.getProjectLlmConfigByProvider(projectId, provider);
	if (config) {
		return {
			apiKey: config.apiKey,
			...(config.baseUrl && { baseURL: config.baseUrl }),
			...(config.credentials && { credentials: config.credentials }),
		};
	}

	const configured = findConfigLlmProvider(await getProjectConfigLlm(projectId), provider);
	if (configured) {
		return toProviderSettings(configured);
	}

	const envApiKey = getEnvApiKey(provider);
	if (envApiKey) {
		const envBaseUrl = getEnvBaseUrl(provider);
		return { apiKey: envApiKey, ...(envBaseUrl && { baseURL: envBaseUrl }) };
	}

	if (hasEnvApiKey(provider)) {
		return { apiKey: '' };
	}

	return null;
}

/**
 * Resolve a provider model from DB config, falling back to nao_config.yaml then env vars.
 * Returns null when no source has credentials for the provider.
 */
export async function resolveProviderModel(
	projectId: string,
	provider: LlmProvider,
	modelId: string,
	applyUserSettings = true,
): Promise<ProviderModelResult | null> {
	const config = await projectLlmConfigQueries.getProjectLlmConfigByProvider(projectId, provider);
	if (config) {
		return createProviderModel(
			provider,
			{
				apiKey: config.apiKey,
				...(config.baseUrl && { baseURL: config.baseUrl }),
				...(config.credentials && { credentials: config.credentials }),
			},
			modelId,
			applyUserSettings ? config.modelSettings?.[modelId] : undefined,
		);
	}

	const configured = findConfigLlmProvider(await getProjectConfigLlm(projectId), provider);
	if (configured) {
		return createProviderModel(
			provider,
			toProviderSettings(configured),
			modelId,
			applyUserSettings ? configured.modelSettings[modelId] : undefined,
		);
	}

	const envApiKey = getEnvApiKey(provider);
	if (envApiKey) {
		const envBaseUrl = getEnvBaseUrl(provider);
		return createProviderModel(
			provider,
			{ apiKey: envApiKey, ...(envBaseUrl && { baseURL: envBaseUrl }) },
			modelId,
		);
	}

	if (hasEnvApiKey(provider)) {
		return createProviderModel(provider, { apiKey: '' }, modelId);
	}

	return null;
}

/** Read the `llm` block of the project's nao_config.yaml, if the project has one on disk. */
export async function getProjectConfigLlm(projectId: string): Promise<ConfigLlm | null> {
	const project = await projectQueries.getProjectById(projectId).catch(() => null);
	if (!project?.path) {
		return null;
	}
	return readProjectConfigLlm(project.path, (project.envVars as Record<string, string>) ?? {});
}

/** Credentials from nao_config.yaml, topped up from the environment for whatever it leaves out. */
function toProviderSettings(configured: ConfigLlmProvider): ProviderSettings {
	const apiKey = configured.apiKey ?? getEnvApiKey(configured.provider) ?? '';
	const baseURL = configured.baseUrl ?? getEnvBaseUrl(configured.provider);

	return {
		apiKey,
		...(baseURL && { baseURL }),
		...(configured.credentials && { credentials: configured.credentials }),
	};
}

/**
 * Resolve the model to use for background tasks (memory extraction, compaction, title generation).
 * Priority: NAO_ANNOTATION_MODEL env var > first model enabled for the provider in the database >
 * `llm.annotation_model` of nao_config.yaml > first model the file enables > provider default.
 */
export async function resolveAnnotationModelId(
	projectId: string,
	provider: LlmProvider,
	fallbackModelId: string,
): Promise<string> {
	const envOverride = process.env.NAO_ANNOTATION_MODEL;
	if (envOverride) {
		return envOverride;
	}

	const config = await projectLlmConfigQueries.getProjectLlmConfigByProvider(projectId, provider);
	const enabledModels = config?.enabledModels ?? [];
	if (enabledModels.length > 0) {
		return enabledModels[0];
	}

	const configLlm = await getProjectConfigLlm(projectId);
	const annotationTarget = resolveConfigAnnotationTarget(configLlm);
	if (annotationTarget?.provider === provider) {
		return annotationTarget.modelId;
	}

	const configured = findConfigLlmProvider(configLlm, provider);
	if (configured?.enabledModels.length) {
		return configured.enabledModels[0];
	}

	return fallbackModelId;
}

/** The provider and model that `llm.annotation_model` points at, mirroring the CLI resolution. */
function resolveConfigAnnotationTarget(configLlm: ConfigLlm | null): { provider: LlmProvider; modelId: string } | null {
	const modelId = configLlm?.annotationModel;
	if (!configLlm || !modelId) {
		return null;
	}

	const owner = configLlm.providers.find((candidate) => candidate.enabledModels.includes(modelId));
	return { provider: (owner ?? configLlm.providers[0]).provider, modelId };
}

export const getProjectAvailableModels = async (
	projectId: string,
): Promise<Array<{ provider: LlmProvider; modelId: string; name: string }>> => {
	const sources = await getProjectModelSources(projectId);

	return sources.flatMap(({ provider, enabledModels, customModels }) => {
		if (enabledModels.length === 0) {
			const modelId = getDefaultModelId(provider);
			return [{ provider, modelId, name: getModelName(provider, modelId) }];
		}

		return enabledModels.map((modelId) => ({
			provider,
			modelId,
			name: customModels.find((m) => m.id === modelId)?.displayName?.trim() || getModelName(provider, modelId),
		}));
	});
};

/** The models declared for each provider, used to price usage on top of nao's built-in table. */
export const getProjectDeclaredModels = async (
	projectId: string,
): Promise<Array<{ provider: LlmProvider; models: CustomModelMetadata[] }>> => {
	const sources = await getProjectModelSources(projectId);
	return sources.map(({ provider, customModels }) => ({ provider, models: customModels }));
};

type ProviderModelSource = {
	provider: LlmProvider;
	enabledModels: string[];
	customModels: CustomModelMetadata[];
};

/**
 * The model list of every provider available to a project, taking each provider from the first
 * source that declares it: the database, then nao_config.yaml, then the environment.
 */
async function getProjectModelSources(projectId: string): Promise<ProviderModelSource[]> {
	const configs = await projectLlmConfigQueries.getProjectLlmConfigs(projectId);
	const sources: ProviderModelSource[] = configs.map((config) => ({
		provider: config.provider as LlmProvider,
		enabledModels: config.enabledModels ?? [],
		customModels: config.customModels ?? [],
	}));

	const declares = (provider: LlmProvider) => sources.some((source) => source.provider === provider);

	const configLlm = await getProjectConfigLlm(projectId);
	for (const configured of configLlm?.providers ?? []) {
		if (!declares(configured.provider)) {
			sources.push({
				provider: configured.provider,
				enabledModels: configured.enabledModels,
				customModels: configured.customModels,
			});
		}
	}

	for (const provider of getEnvProviders()) {
		if (!declares(provider)) {
			sources.push({ provider, enabledModels: [], customModels: [] });
		}
	}

	return sources;
}

const getModelName = (provider: LlmProvider, modelId: string): string =>
	LLM_PROVIDERS[provider].models.find((m) => m.id === modelId)?.name ?? modelId;
