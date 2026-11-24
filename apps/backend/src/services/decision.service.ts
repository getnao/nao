import type { LlmProvider } from '@nao/shared/types';

import { callDecisionModel, DECISION_PROVIDER_META } from '../agents/decision.providers';
import type { DBProjectDecisionConfig } from '../db/abstractSchema';
import * as projectQueries from '../queries/project.queries';
import * as decisionConfigQueries from '../queries/project-decision-config.queries';
import {
	DECISION_PROVIDERS,
	type DecisionKeySource,
	type DecisionModel,
	type DecisionProvider,
	type DecisionQuestions,
	type DecisionRequest,
	type DecisionResult,
} from '../types/decision';
import type { ProviderSettings } from '../types/llm';
import { projectEndpointSettings, resolveProviderSettings } from '../utils/llm';
import { type ConfigDecision, readProjectConfigDecision } from '../utils/nao-config-decision';
import { scheduleSaveLlmInferenceRecord } from '../utils/schedule-task';
import { buildCredentialPreviews, previewApiKey } from '../utils/utils';

const SETTINGS_PATH = 'Settings > Agent > Decision models';

/** Who a decision is made for, so its tokens show in their usage. */
export type DecisionCaller = { projectId: string; userId: string; chatId?: string };

/**
 * Ask the project's decision model every question about one state. Runs on `model` when given,
 * otherwise on the model the project pinned, falling back to the first provider it can reach.
 */
export async function decide<Q extends DecisionQuestions>(
	caller: DecisionCaller,
	request: DecisionRequest<Q>,
	model?: DecisionModel,
): Promise<DecisionResult<Q>> {
	const context = await loadAccessContext(caller.projectId);
	const selected = model
		? { model, access: await resolveAccess(context, model.provider) }
		: await selectModel(context);

	if (!selected) {
		throw new Error(`No decision model is available. Connect a provider in ${SETTINGS_PATH}.`);
	}
	if (!selected.access) {
		const { label } = DECISION_PROVIDER_META[selected.model.provider];
		throw new Error(`${label} is not connected. Add its credentials in ${SETTINGS_PATH}.`);
	}
	const { provider, modelId } = selected.model;
	return callDecisionModel(provider, selected.access.settings, modelId, request, (usage) =>
		recordUsage(caller, selected.model, usage),
	);
}

function recordUsage(caller: DecisionCaller, model: DecisionModel, usage: DecisionResult['usage']): void {
	scheduleSaveLlmInferenceRecord({
		...caller,
		type: 'decision',
		llmProvider: model.provider,
		llmModelId: model.modelId,
		inputTotalTokens: usage.inputTokens,
		inputNoCacheTokens: usage.inputTokens,
		outputTotalTokens: usage.outputTokens,
		totalTokens: usage.inputTokens + usage.outputTokens,
	});
}

/** Every decision provider with where its credentials come from, and the model decisions run on. */
export async function getDecisionSettings(projectId: string) {
	const context = await loadAccessContext(projectId);
	const providers = await Promise.all(
		DECISION_PROVIDERS.map(async (provider) => {
			const meta = DECISION_PROVIDER_META[provider];
			const access = await resolveAccess(context, provider);
			const showsKey = access?.source === 'project' || access?.source === 'config';
			return {
				provider,
				label: meta.label,
				apiKey: meta.apiKey,
				requiresBaseUrl: !meta.defaultBaseUrl,
				extraFields: (meta.extraFields ?? []).map(({ name, label }) => ({ name, label })),
				models: meta.models,
				customModels: meta.customModels ?? false,
				source: access?.source ?? null,
				apiKeyPreview: showsKey ? previewApiKey(access.settings.apiKey) : null,
				credentialPreviews: showsKey ? buildCredentialPreviews(access.settings.credentials) : null,
				baseUrl: access?.settings.baseURL ?? null,
				isSaved: context.saved.some((row) => row.provider === provider),
			};
		}),
	);
	return { providers, model: (await selectModel(context))?.model ?? null };
}

/**
 * The keys saved for decision providers, by the LLM provider of the same vendor, which can start from them.
 * A key saved with a base URL belongs to that endpoint, so it is not offered to the vendor's own API.
 */
export async function getDecisionKeysByLlmProvider(projectId: string): Promise<Map<LlmProvider, string>> {
	const saved = await decisionConfigQueries.getProjectDecisionConfigs(projectId);
	return new Map(
		saved.flatMap((row) => {
			const { llmProvider } = DECISION_PROVIDER_META[row.provider];
			return llmProvider && row.apiKey && !row.baseUrl ? [[llmProvider, row.apiKey] as const] : [];
		}),
	);
}

type DecisionAccess = { source: DecisionKeySource; settings: ProviderSettings };

type AccessContext = {
	projectId: string;
	saved: DBProjectDecisionConfig[];
	config: ConfigDecision | null;
	pinnedModel: DecisionModel | null;
};

async function loadAccessContext(projectId: string): Promise<AccessContext> {
	const [project, saved] = await Promise.all([
		projectQueries.getProjectById(projectId),
		decisionConfigQueries.getProjectDecisionConfigs(projectId),
	]);
	return {
		projectId,
		saved,
		config: project?.path ? readProjectConfigDecision(project.path, project.envVars ?? {}) : null,
		pinnedModel: project?.agentSettings?.decision ?? null,
	};
}

/** The pinned model when its provider is connected, otherwise the first model of a connected provider. */
async function selectModel(context: AccessContext): Promise<{ model: DecisionModel; access: DecisionAccess } | null> {
	const defaults = DECISION_PROVIDERS.flatMap((provider) =>
		DECISION_PROVIDER_META[provider].models.slice(0, 1).map((model) => ({ provider, modelId: model.id })),
	);
	const candidates = [context.pinnedModel, context.config?.model, ...defaults].filter((model) => !!model);

	for (const model of candidates) {
		const access = await resolveAccess(context, model.provider);
		if (access) {
			return { model, access };
		}
	}
	return null;
}

/**
 * Credentials of a provider from the first source holding usable ones: the key saved in the settings,
 * nao_config.yaml, the LLM provider of the same vendor, then the environment. A source is taken whole,
 * so a key is never sent to the base URL of another source.
 */
async function resolveAccess(context: AccessContext, provider: DecisionProvider): Promise<DecisionAccess | null> {
	for (const source of ACCESS_SOURCES) {
		const settings = await ACCESS_READERS[source](context, provider);
		if (settings && isUsable(provider, settings)) {
			return { source, settings };
		}
	}
	return null;
}

const ACCESS_SOURCES: DecisionKeySource[] = ['project', 'config', 'llm', 'env'];

type AccessReader = (context: AccessContext, provider: DecisionProvider) => Promise<ProviderSettings | null>;

const ACCESS_READERS: Record<DecisionKeySource, AccessReader> = {
	project: async ({ saved }, provider) => toProjectSettings(saved.find((row) => row.provider === provider)),
	config: async ({ config }, provider) =>
		toProjectSettings(config?.providers.find((entry) => entry.provider === provider)),
	llm: async ({ projectId }, provider) => {
		const { llmProvider } = DECISION_PROVIDER_META[provider];
		return llmProvider ? resolveProviderSettings(projectId, llmProvider) : null;
	},
	env: async (_context, provider) => readEnvSettings(provider),
};

function toProjectSettings(
	entry: Pick<DBProjectDecisionConfig, 'apiKey' | 'baseUrl' | 'credentials'> | undefined,
): ProviderSettings | null {
	if (!entry) {
		return null;
	}
	return {
		apiKey: entry.apiKey ?? '',
		...projectEndpointSettings(entry.baseUrl),
		...(entry.credentials && { credentials: entry.credentials }),
	};
}

function readEnvSettings(provider: DecisionProvider): ProviderSettings | null {
	const { envVars, baseUrlEnvVar, extraFields = [] } = DECISION_PROVIDER_META[provider];
	const apiKey = envVars.map((name) => process.env[name]).find(Boolean) ?? '';
	const baseURL = baseUrlEnvVar ? process.env[baseUrlEnvVar] : undefined;
	if (!apiKey && !baseURL) {
		return null;
	}

	const credentials = Object.fromEntries(
		extraFields
			.map((field) => [field.name, process.env[field.envVar]] as const)
			.filter((entry): entry is [string, string] => !!entry[1]),
	);
	return { apiKey, ...(baseURL && { baseURL }), credentials };
}

function isUsable(provider: DecisionProvider, settings: ProviderSettings): boolean {
	const meta = DECISION_PROVIDER_META[provider];
	const hasKey = meta.apiKey !== 'required' || !!settings.apiKey;
	const hasEndpoint = !!(settings.baseURL ?? meta.defaultBaseUrl);
	const hasExtraFields = (meta.extraFields ?? []).every((field) => !!settings.credentials?.[field.name]);
	return hasKey && hasEndpoint && hasExtraFields;
}
