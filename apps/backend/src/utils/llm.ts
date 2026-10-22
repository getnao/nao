import { type BackgroundModelCategory, type DefaultModelSettings, selectBackgroundModel } from '@nao/shared';
import { type LlmProvider, type LlmSelectedModel, providerKind } from '@nao/shared/types';

import { managedAiSource, type ManagedAiUsageContext } from '../agents/managed-ai';
import {
	createProviderModel,
	getDefaultModelId,
	getProviderMeta,
	isManagedProvider,
	LLM_PROVIDERS,
	type ProviderModelResult,
} from '../agents/providers';
import { env } from '../env';
import * as projectQueries from '../queries/project.queries';
import * as projectLlmConfigQueries from '../queries/project-llm-config.queries';
import type {
	CustomModelMetadata,
	ModelRequest,
	ModelSettingsMap,
	ModelSource,
	ProviderModelSource,
	ProviderSettings,
} from '../types/llm';
import { type ConfigLlm, type ConfigLlmProvider, findConfigLlmProvider, readProjectConfigLlm } from './nao-config-llm';

export { getDefaultModelId };

/** Get the API key from environment for a provider */
export function getEnvApiKey(provider: LlmProvider): string | undefined {
	const { envVar } = getProviderMeta(provider);
	return envVar ? process.env[envVar] : undefined;
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

/** Resolve API key + base URL for a provider from the first model source that hands out credentials for it. */
export async function resolveProviderSettings(
	projectId: string,
	provider: LlmProvider,
): Promise<ProviderSettings | null> {
	if (isProviderDisabled(provider)) {
		return null;
	}
	for (const source of getSourcesServing(provider)) {
		const settings = await source.resolveSettings?.(projectId, provider);
		if (settings) {
			return settings;
		}
	}
	return null;
}

/**
 * Resolve a provider model from the first model source that serves it: DB config, nao_config.yaml,
 * env vars, then nao's managed models. Returns null when no source has credentials for the provider.
 */
export async function resolveProviderModel(
	projectId: string,
	provider: LlmProvider,
	modelId: string,
	applyUserSettings = true,
	usageContext?: ManagedAiUsageContext,
): Promise<ProviderModelResult | null> {
	if (isProviderDisabled(provider)) {
		return null;
	}
	const request: ModelRequest = {
		projectId,
		provider,
		modelId,
		applyUserSettings,
		usageContext,
		hasOwnModels() {
			return hasOwnSelectableModel(projectId);
		},
	};
	for (const source of getSourcesServing(provider)) {
		const result = await source.resolveModel(request);
		if (result) {
			return result;
		}
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
	return resolvePinnedModel(projectId, configured);
}

/** A pinned model, substituted with an available one when it has been disabled or removed. */
export async function resolvePinnedModel(
	projectId: string,
	pinned: LlmSelectedModel,
): Promise<LlmSelectedModel | null> {
	return substituteUnavailableModel(await getProjectAvailableModels(projectId), pinned);
}

/**
 * The model a run uses when nothing selects one explicitly: the chat default an admin pinned
 * (substituted when it is no longer available), otherwise the first model the picker offers.
 * Returns null when the project has no model at all.
 */
export async function resolveDefaultChatModel(projectId: string): Promise<LlmSelectedModel | null> {
	const [settings, available] = await Promise.all([
		projectQueries.getDefaultModelSettings(projectId),
		getProjectAvailableModels(projectId),
	]);
	return selectDefaultChatModel(settings, available);
}

/** `resolveDefaultChatModel` over settings and a catalog the caller already loaded. */
export function selectDefaultChatModel(
	settings: DefaultModelSettings | null,
	available: Array<{ provider: LlmProvider; modelId: string }>,
): LlmSelectedModel | null {
	if (settings?.chat) {
		return substituteUnavailableModel(available, settings.chat);
	}
	const first = available.at(0);
	return first ? { provider: first.provider, modelId: first.modelId } : null;
}

function substituteUnavailableModel(
	available: Array<{ provider: LlmProvider; modelId: string }>,
	configured: LlmSelectedModel,
): LlmSelectedModel | null {
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

export type ProjectAvailableModel = Awaited<ReturnType<typeof getProjectAvailableModels>>[number];

/** Raised when an MCP caller names a model the project does not expose. The message is safe to relay. */
export class RequestedModelError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RequestedModelError';
	}
}

/**
 * Picks the model an MCP caller asked for among the project's available models. `requested` is a
 * model id as the model picker lists it (`mistral-large-4`), or `provider/model-id` when the same
 * id is served by several providers. Matching ignores case and also accepts the display name.
 * Provider ids and model ids may themselves contain `/` (`openaiCompatible/prod`,
 * `mistralai/mistral-large`), so every split of the requested value is tried.
 */
export function pickRequestedModel(available: ProjectAvailableModel[], requested: string): LlmSelectedModel {
	const wanted = requested.trim().toLowerCase();
	if (!wanted) {
		throw new RequestedModelError('`model` must not be empty.');
	}

	const matchesId = (m: ProjectAvailableModel, id: string): boolean =>
		m.modelId.toLowerCase() === id || m.name.trim().toLowerCase() === id;

	let candidates = available.filter((m) => matchesId(m, wanted));
	for (
		let slash = wanted.indexOf('/');
		candidates.length === 0 && slash > 0;
		slash = wanted.indexOf('/', slash + 1)
	) {
		const provider = wanted.slice(0, slash);
		const id = wanted.slice(slash + 1);
		candidates = available.filter((m) => m.provider.toLowerCase() === provider && matchesId(m, id));
	}

	if (candidates.length === 1) {
		return { provider: candidates[0].provider, modelId: candidates[0].modelId };
	}
	if (candidates.length === 0) {
		const list = available.map((m) => `${m.provider}/${m.modelId}`).join(', ') || 'none';
		throw new RequestedModelError(`Unknown model "${requested}". Available models: ${list}.`);
	}
	const qualified = candidates.map((m) => `${m.provider}/${m.modelId}`).join(', ');
	throw new RequestedModelError(
		`Model "${requested}" is served by several providers. Qualify it as provider/model-id: ${qualified}.`,
	);
}

/** Models listed in the `ask_nao` `model` description; the rest are only reachable by name. */
export const MODEL_INPUT_LISTED_MAX = 20;

/**
 * The `model` input description of `ask_nao`, with the project's available models so an MCP
 * caller picks one without a failed round trip. Models are written the way `pickRequestedModel`
 * resolves them: the bare id, or `provider/model-id` when several providers serve the same id.
 * The default is the model a call without `model` runs on. `available` is null when the catalog
 * could not be read, in which case the description carries no list.
 */
export function describeModelInput(
	available: ProjectAvailableModel[] | null,
	defaultModel: LlmSelectedModel | null,
): string {
	if (available === null) {
		return `${MODEL_INPUT_INTRO} ${MODEL_INPUT_OMIT}`;
	}
	const isDefault = (m: ProjectAvailableModel): boolean =>
		defaultModel !== null && m.provider === defaultModel.provider && m.modelId === defaultModel.modelId;
	const sharedIds = new Set(
		available.filter((m, i) => available.some((o, j) => j !== i && o.modelId === m.modelId)).map((m) => m.modelId),
	);
	const label = (m: ProjectAvailableModel): string =>
		`\`${sharedIds.has(m.modelId) ? `${m.provider}/${m.modelId}` : m.modelId}\`${isDefault(m) ? ' (default)' : ''}`;

	const listed = available.slice(0, MODEL_INPUT_LISTED_MAX).map(label);
	const hidden = available.length - listed.length;
	const catalog =
		listed.length === 0
			? 'No model is configured on this project.'
			: `Available models: ${listed.join(', ')}${hidden > 0 ? ` and ${hidden} more` : ''}.`;

	return `${MODEL_INPUT_INTRO} ${catalog} ${MODEL_INPUT_OMIT}`;
}

const MODEL_INPUT_INTRO =
	'Model to run the sub-agent with, as listed in the project model picker (e.g. `mistral-large-4`), ' +
	'or `provider/model-id` when several providers serve the same id.';
const MODEL_INPUT_OMIT =
	'Omit to use the default: the model pinned in the MCP settings, else the project default chat model.';

/** `pickRequestedModel` against the project's current model catalog. */
export async function resolveRequestedModel(projectId: string, requested: string): Promise<LlmSelectedModel> {
	return pickRequestedModel(await getProjectAvailableModels(projectId), requested);
}

/** The models declared for each provider, used to price usage on top of nao's built-in table. */
export const getProjectDeclaredModels = async (
	projectId: string,
): Promise<Array<{ provider: LlmProvider; models: CustomModelMetadata[] }>> => {
	const sources = await getProjectModelSources(projectId);
	return sources.map(({ provider, customModels }) => ({ provider, models: customModels }));
};

/** Names models the way the project lists them, falling back to nao's catalogue then the raw model id. */
export const getProjectModelNameResolver = async (
	projectId: string,
): Promise<(provider: LlmProvider, modelId: string) => string> => {
	const declaredModels = await getProjectDeclaredModels(projectId);
	return (provider, modelId) => {
		const declared = declaredModels.find((d) => d.provider === provider)?.models.find((m) => m.id === modelId);
		return declared?.displayName?.trim() || getModelName(provider, modelId);
	};
};

/**
 * The model list of every provider available to a project, taking each provider from the first
 * source that declares it. Managed sources are only offered when no other source has a selectable model.
 */
async function getProjectModelSources(projectId: string): Promise<ProviderModelSource[]> {
	const ownProviders = await collectProviders(projectId, { managed: false });
	if (ownProviders.some(hasSelectableModel)) {
		return ownProviders;
	}
	return [...ownProviders, ...(await collectProviders(projectId, { managed: true }))];
}

async function hasOwnSelectableModel(projectId: string): Promise<boolean> {
	const ownProviders = await collectProviders(projectId, { managed: false });
	return ownProviders.some(hasSelectableModel);
}

async function collectProviders(projectId: string, { managed }: { managed: boolean }): Promise<ProviderModelSource[]> {
	const collected: ProviderModelSource[] = [];
	for (const source of getModelSources().filter((candidate) => Boolean(candidate.managed) === managed)) {
		for (const entry of await source.listProviders(projectId)) {
			const isFirstDeclaration = !collected.some((existing) => existing.provider === entry.provider);
			if (isFirstDeclaration && servesProvider(source, entry.provider) && !isProviderDisabled(entry.provider)) {
				collected.push(entry);
			}
		}
	}
	return collected;
}

function hasSelectableModel(source: ProviderModelSource): boolean {
	return source.enabledModels.length > 0 || Boolean(getDefaultModelId(source.provider));
}

function getSourcesServing(provider: LlmProvider): ModelSource[] {
	return getModelSources().filter((source) => servesProvider(source, provider));
}

/** Managed providers run on nao's own keys, so only managed sources serve them. */
function servesProvider(source: ModelSource, provider: LlmProvider): boolean {
	return Boolean(source.managed) === isManagedProvider(provider);
}

const getModelName = (provider: LlmProvider, modelId: string): string =>
	getProviderMeta(provider).models.find((m) => m.id === modelId)?.name ?? modelId;

type ProviderAccess = { settings: ProviderSettings; modelSettings?: ModelSettingsMap | null };

type CredentialSource = {
	listProviders(projectId: string): Promise<ProviderModelSource[]>;
	findAccess(projectId: string, provider: LlmProvider): Promise<ProviderAccess | null>;
};

/** A source holding the project's own credentials, which can also be handed out for direct provider calls. */
function credentialSource(source: CredentialSource): ModelSource {
	return {
		listProviders: source.listProviders,
		async resolveSettings(projectId, provider) {
			return (await source.findAccess(projectId, provider))?.settings ?? null;
		},
		async resolveModel({ projectId, provider, modelId, applyUserSettings }) {
			const access = await source.findAccess(projectId, provider);
			if (!access) {
				return null;
			}
			const inferenceSettings = applyUserSettings ? access.modelSettings?.[modelId] : undefined;
			return createProviderModel(provider, access.settings, modelId, inferenceSettings);
		},
	};
}

const projectConfigSource = credentialSource({
	async listProviders(projectId) {
		const configs = await projectLlmConfigQueries.getProjectLlmConfigs(projectId);
		return configs.map((config) => ({
			provider: config.provider as LlmProvider,
			enabledModels: config.enabledModels ?? [],
			customModels: config.customModels ?? [],
			baseUrl: config.baseUrl ?? getEnvBaseUrl(config.provider as LlmProvider) ?? null,
		}));
	},
	async findAccess(projectId, provider) {
		const config = await projectLlmConfigQueries.getProjectLlmConfigByProvider(projectId, provider);
		if (!config) {
			return null;
		}
		const settings = {
			apiKey: config.apiKey,
			...(config.baseUrl && { baseURL: config.baseUrl }),
			...(config.credentials && { credentials: config.credentials }),
		};
		return { settings, modelSettings: config.modelSettings };
	},
});

const naoConfigFileSource = credentialSource({
	async listProviders(projectId) {
		const configLlm = await getProjectConfigLlm(projectId);
		return (configLlm?.providers ?? []).map((configured) => ({
			provider: configured.provider,
			enabledModels: configured.enabledModels,
			customModels: configured.customModels,
			baseUrl: configured.baseUrl ?? getEnvBaseUrl(configured.provider) ?? null,
		}));
	},
	async findAccess(projectId, provider) {
		const configured = findConfigLlmProvider(await getProjectConfigLlm(projectId), provider);
		if (!configured) {
			return null;
		}
		return { settings: toProviderSettings(configured), modelSettings: configured.modelSettings };
	},
});

const envSource = credentialSource({
	async listProviders() {
		return getEnvProviders().map((provider) => ({
			provider,
			enabledModels: [],
			customModels: [],
			baseUrl: getEnvBaseUrl(provider) ?? null,
		}));
	},
	async findAccess(_projectId, provider) {
		if (!hasEnvApiKey(provider)) {
			return null;
		}
		const baseURL = getEnvBaseUrl(provider);
		return { settings: { apiKey: getEnvApiKey(provider) ?? '', ...(baseURL && { baseURL }) } };
	},
});

/** Built on call: `managed-ai` imports this module back through the project queries, so it may not be loaded yet. */
function getModelSources(): ModelSource[] {
	return [projectConfigSource, naoConfigFileSource, envSource, managedAiSource];
}
