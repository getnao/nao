import { type BackgroundModelCategory, selectBackgroundModel } from '@nao/shared';
import { type LlmProvider, type LlmSelectedModel, providerKind } from '@nao/shared/types';

import {
	createProviderModel,
	getDefaultModelId,
	getProviderMeta,
	LLM_PROVIDERS,
	type ProviderModelResult,
} from '../agents/providers';
import { env } from '../env';
import * as projectQueries from '../queries/project.queries';
import * as projectLlmConfigQueries from '../queries/project-llm-config.queries';
import type { CustomModelMetadata, ProviderSettings } from '../types/llm';
import { type ConfigLlm, type ConfigLlmProvider, findConfigLlmProvider, readProjectConfigLlm } from './nao-config-llm';

export { getDefaultModelId };

/** Get the API key from environment for a provider */
export function getEnvApiKey(provider: LlmProvider): string | undefined {
	return process.env[getProviderMeta(provider).envVar];
}

/** Get the base URL from environment for a provider (e.g. OPENAI_BASE_URL) */
export function getEnvBaseUrl(provider: LlmProvider): string | undefined {
	const { baseUrlEnvVar } = getProviderMeta(provider);
	return baseUrlEnvVar ? process.env[baseUrlEnvVar] : undefined;
}

/** Whether DISABLED_PROVIDERS opts this provider out, by its own id or by its kind. */
export function isProviderDisabled(provider: LlmProvider): boolean {
	return env.DISABLED_PROVIDERS.includes(provider) || env.DISABLED_PROVIDERS.includes(providerKind(provider));
}

/** Check if a provider has authentication configured via environment */
export function hasEnvApiKey(provider: LlmProvider): boolean {
	if (isProviderDisabled(provider)) {
		return false;
	}
	if (getEnvApiKey(provider)) {
		return true;
	}
	const { alternativeEnvVars, extraFields, apiKey } = getProviderMeta(provider).auth;
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
	return getProviderMeta(provider).models.some((m) => m.id === modelId);
}

/** Get all known model IDs for a provider */
export function getKnownModelIds(provider: LlmProvider): string[] {
	return getProviderMeta(provider).models.map((m) => m.id);
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
	if (isProviderDisabled(provider)) {
		return null;
	}
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
		const envBaseUrl = getEnvBaseUrl(provider);
		return { apiKey: '', ...(envBaseUrl && { baseURL: envBaseUrl }) };
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
	if (isProviderDisabled(provider)) {
		return null;
	}
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
		const envBaseUrl = getEnvBaseUrl(provider);
		return createProviderModel(provider, { apiKey: '', ...(envBaseUrl && { baseURL: envBaseUrl }) }, modelId);
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
 * Custom endpoints use the active model because their available model catalogue is unknown.
 */
export async function resolveAnnotationModelId(
	projectId: string,
	modelSelection: LlmSelectedModel,
	fallbackModelId: string,
): Promise<string> {
	const envOverride = process.env.NAO_ANNOTATION_MODEL;
	if (envOverride) {
		return envOverride;
	}

	const { provider, modelId } = modelSelection;
	const config = await projectLlmConfigQueries.getProjectLlmConfigByProvider(projectId, provider);
	if (config?.baseUrl) {
		return modelId;
	}

	const enabledModels = config?.enabledModels ?? [];
	if (enabledModels.length > 0) {
		return enabledModels[0];
	}

	const configLlm = await getProjectConfigLlm(projectId);
	const configured = findConfigLlmProvider(configLlm, provider);
	if (!config && (configured?.baseUrl ?? getEnvBaseUrl(provider))) {
		return modelId;
	}

	const annotationTarget = resolveConfigAnnotationTarget(configLlm);
	if (annotationTarget?.provider === provider) {
		return annotationTarget.modelId;
	}

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

/**
 * The model an admin pinned for a background task, substituting an available model when the pinned
 * one has been disabled or removed. Returns null when no default is configured for the category, so
 * callers fall back to nao's built-in per-provider defaults.
 */
export async function resolveDefaultModelSelection(
	projectId: string,
	category: BackgroundModelCategory,
): Promise<LlmSelectedModel | null> {
	const configured = selectBackgroundModel(await projectQueries.getDefaultModelSettings(projectId), category);
	if (!configured) {
		return null;
	}

	const available = await getProjectAvailableModels(projectId);
	if (available.length === 0) {
		return null;
	}
	if (available.some((m) => m.provider === configured.provider && m.modelId === configured.modelId)) {
		return configured;
	}

	const substitute = available.find((m) => m.provider === configured.provider) ?? available[0];
	return { provider: substitute.provider, modelId: substitute.modelId };
}

export const getProjectAvailableModels = async (
	projectId: string,
): Promise<Array<{ provider: LlmProvider; modelId: string; name: string; baseUrl: string | null }>> => {
	const sources = await getProjectModelSources(projectId);

	return sources.flatMap(({ provider, enabledModels, customModels, baseUrl }) => {
		if (enabledModels.length === 0) {
			// Providers with no built-in catalogue (Azure deployments, custom endpoints) only
			// expose the models an admin declared, so they contribute nothing until then.
			const modelId = getDefaultModelId(provider);
			return modelId ? [{ provider, modelId, name: getModelName(provider, modelId), baseUrl }] : [];
		}

		return enabledModels.map((modelId) => ({
			provider,
			modelId,
			name: customModels.find((m) => m.id === modelId)?.displayName?.trim() || getModelName(provider, modelId),
			baseUrl,
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
	baseUrl: string | null;
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
		baseUrl: config.baseUrl ?? getEnvBaseUrl(config.provider as LlmProvider) ?? null,
	}));

	const declares = (provider: LlmProvider) => sources.some((source) => source.provider === provider);

	const configLlm = await getProjectConfigLlm(projectId);
	for (const configured of configLlm?.providers ?? []) {
		if (!declares(configured.provider)) {
			sources.push({
				provider: configured.provider,
				enabledModels: configured.enabledModels,
				customModels: configured.customModels,
				baseUrl: configured.baseUrl ?? getEnvBaseUrl(configured.provider) ?? null,
			});
		}
	}

	for (const provider of getEnvProviders()) {
		if (!declares(provider)) {
			sources.push({
				provider,
				enabledModels: [],
				customModels: [],
				baseUrl: getEnvBaseUrl(provider) ?? null,
			});
		}
	}

	return sources.filter((source) => !isProviderDisabled(source.provider));
}

const getModelName = (provider: LlmProvider, modelId: string): string =>
	getProviderMeta(provider).models.find((m) => m.id === modelId)?.name ?? modelId;
