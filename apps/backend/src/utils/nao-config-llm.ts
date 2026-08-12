import fs from 'node:fs';
import path from 'node:path';

import {
	BUDGET_PERIODS,
	type BudgetPeriod,
	LLM_PROVIDERS as LLM_PROVIDER_NAMES,
	type LlmProvider,
	type LlmProviderKind,
	MAX_BUDGET_LIMIT_USD,
	NAMED_PROVIDER_KIND,
	providerKind,
	toNamedProvider,
	toProviderName,
} from '@nao/shared/types';
import yaml from 'js-yaml';
import { z } from 'zod/v4';

import {
	type CustomModelMetadata,
	type ModelInferenceSettings,
	modelInferenceSettingsSchema,
	type ModelSettingsMap,
} from '../types/llm';
import { logger } from './logger';

export type ConfigProviderBudget = {
	limitUsd: number;
	perUserLimitUsd: number | null;
	period: BudgetPeriod;
};

/** An `llm` provider entry of nao_config.yaml, shaped like the rows of `project_llm_config`. */
export type ConfigLlmProvider = {
	provider: LlmProvider;
	apiKey: string | null;
	baseUrl: string | null;
	credentials: Record<string, string> | null;
	enabledModels: string[];
	customModels: CustomModelMetadata[];
	modelSettings: ModelSettingsMap;
	budget: ConfigProviderBudget | null;
};

export type ConfigLlm = {
	providers: ConfigLlmProvider[];
	annotationModel: string | null;
};

/** Spellings accepted in nao_config.yaml on top of the provider names nao uses internally. */
const PROVIDER_ALIASES: Record<string, LlmProviderKind> = {
	gemini: 'google',
	openaicompatible: 'openaiCompatible',
	'openai-compatible': 'openaiCompatible',
	openai_compatible: 'openaiCompatible',
};

/** Maps the credential keys of nao_config.yaml onto the `credentials` names each provider expects. */
const CREDENTIAL_KEYS: Partial<Record<LlmProviderKind, Record<string, string>>> = {
	bedrock: { aws_region: 'region', access_key: 'accessKeyId', secret_key: 'secretAccessKey' },
	vertex: {
		gcp_project: 'project',
		gcp_location: 'location',
		service_account_json: 'serviceAccountJson',
		key_file: 'keyFile',
	},
	azure: { resource_name: 'resourceName', api_version: 'apiVersion' },
};

const SECRET_PATTERN = /\$?\{\{\s*(env|aws|k8s)\(['"]([^'"]+)['"]\)\s*\}\}/g;

const costsSchema = z.object({
	input_no_cache: z.number().min(0).optional(),
	input_cache_read: z.number().min(0).optional(),
	input_cache_write: z.number().min(0).optional(),
	output: z.number().min(0).optional(),
});

const modelSchema = z.object({
	id: z.string().min(1),
	name: z.string().optional(),
	default: z.boolean().optional(),
	costs: costsSchema.optional(),
	settings: z.record(z.string(), z.unknown()).optional(),
});

const budgetSchema = z.object({
	limit: z.number().min(0).nullish(),
	per_user_limit: z.number().min(0).nullish(),
	period: z.enum(BUDGET_PERIODS).nullish(),
});

const providerSchema = z.looseObject({
	provider: z.string(),
	api_key: z.string().nullish(),
	base_url: z.string().nullish(),
	models: z.array(modelSchema).nullish(),
	budget: budgetSchema.nullish(),
});

const llmSchema = z.looseObject({
	providers: z.array(providerSchema).nullish(),
	annotation_model: z.string().nullish(),
});

type RawProvider = z.infer<typeof providerSchema>;

/**
 * Read the `llm` block of a project's nao_config.yaml.
 *
 * Returns null when the project has no config file, no `llm` block, or one nao cannot make
 * sense of, so that callers fall back to the database and the environment.
 */
export function readProjectConfigLlm(projectPath: string, extraEnv: Record<string, string> = {}): ConfigLlm | null {
	const raw = loadLlmBlock(projectPath);
	if (!raw) {
		return null;
	}

	const parsed = llmSchema.safeParse(raw);
	if (!parsed.success) {
		logger.warn(`Ignoring the \`llm\` block of ${configPath(projectPath)}: ${parsed.error.message}`, {
			source: 'system',
		});
		return null;
	}

	const providers = (parsed.data.providers ?? [normalizeLegacyShape(parsed.data)])
		.map((provider) => toConfigProvider(provider, extraEnv))
		.filter((provider): provider is ConfigLlmProvider => provider !== null);

	if (providers.length === 0) {
		return null;
	}

	return { providers, annotationModel: parsed.data.annotation_model ?? null };
}

export function findConfigLlmProvider(config: ConfigLlm | null, provider: LlmProvider): ConfigLlmProvider | null {
	return config?.providers.find((candidate) => candidate.provider === provider) ?? null;
}

const rawCache = new Map<string, { mtimeMs: number; llm: unknown }>();

/** Parse the config file, caching by modification time so hot paths only pay a stat. */
function loadLlmBlock(projectPath: string): unknown {
	const filePath = configPath(projectPath);

	let mtimeMs: number;
	try {
		mtimeMs = fs.statSync(filePath).mtimeMs;
	} catch {
		rawCache.delete(filePath);
		return null;
	}

	const cached = rawCache.get(filePath);
	if (cached?.mtimeMs === mtimeMs) {
		return cached.llm;
	}

	let llm: unknown = null;
	try {
		const config = yaml.load(fs.readFileSync(filePath, 'utf-8'));
		llm = isRecord(config) ? (config.llm ?? null) : null;
	} catch (err) {
		logger.warn(`Failed to parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`, {
			source: 'system',
		});
	}

	rawCache.set(filePath, { mtimeMs, llm });
	return llm;
}

/** Treat a single inline provider as the one entry of `providers`. */
function normalizeLegacyShape(llm: Record<string, unknown>): RawProvider {
	const { providers: _providers, annotation_model: _annotationModel, meta: _meta, ...provider } = llm;
	return provider as RawProvider;
}

function toConfigProvider(raw: RawProvider, extraEnv: Record<string, string>): ConfigLlmProvider | null {
	const provider = resolveProviderName(raw.provider);
	if (!provider) {
		logger.warn(`Ignoring unknown LLM provider '${raw.provider}' in nao_config.yaml`, { source: 'system' });
		return null;
	}

	const models = (raw.models ?? []).filter((model) => model.id);
	const ordered = [...models].sort((a, b) => Number(b.default ?? false) - Number(a.default ?? false));

	return {
		provider,
		apiKey: resolveSecrets(raw.api_key, extraEnv),
		baseUrl: resolveSecrets(raw.base_url, extraEnv),
		credentials: toCredentials(provider, raw, extraEnv),
		enabledModels: ordered.map((model) => model.id),
		customModels: ordered.flatMap((model) => toCustomModel(model)),
		modelSettings: toModelSettings(ordered),
		budget: toBudget(raw.budget),
	};
}

/** Read the `budget` block of a provider, keeping only the limits that actually cap spending. */
function toBudget(raw: RawProvider['budget']): ConfigProviderBudget | null {
	if (!raw) {
		return null;
	}

	const limitUsd = clampBudget(raw.limit);
	const perUserLimitUsd = clampBudget(raw.per_user_limit);
	if (limitUsd <= 0 && perUserLimitUsd <= 0) {
		return null;
	}

	return {
		limitUsd,
		perUserLimitUsd: perUserLimitUsd > 0 ? perUserLimitUsd : null,
		period: raw.period ?? 'month',
	};
}

function clampBudget(value: number | null | undefined): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		return 0;
	}
	return Math.min(value, MAX_BUDGET_LIMIT_USD);
}

function toCredentials(
	provider: LlmProvider,
	raw: RawProvider,
	extraEnv: Record<string, string>,
): Record<string, string> | null {
	const credentials: Record<string, string> = {};

	for (const [configKey, credentialKey] of Object.entries(CREDENTIAL_KEYS[providerKind(provider)] ?? {})) {
		const value = resolveSecrets(raw[configKey], extraEnv);
		if (value) {
			credentials[credentialKey] = value;
		}
	}

	return Object.keys(credentials).length > 0 ? credentials : null;
}

function toCustomModel(model: z.infer<typeof modelSchema>): CustomModelMetadata[] {
	const costPerM = model.costs && {
		...(model.costs.input_no_cache !== undefined && { inputNoCache: model.costs.input_no_cache }),
		...(model.costs.input_cache_read !== undefined && { inputCacheRead: model.costs.input_cache_read }),
		...(model.costs.input_cache_write !== undefined && { inputCacheWrite: model.costs.input_cache_write }),
		...(model.costs.output !== undefined && { output: model.costs.output }),
	};

	if (!model.name && !costPerM) {
		return [];
	}

	return [
		{
			id: model.id,
			...(model.name && { displayName: model.name }),
			...(costPerM && Object.keys(costPerM).length > 0 && { costPerM }),
		},
	];
}

function toModelSettings(models: z.infer<typeof modelSchema>[]): ModelSettingsMap {
	const settings: ModelSettingsMap = {};

	for (const model of models) {
		if (!model.settings) {
			continue;
		}

		const parsed = modelInferenceSettingsSchema.safeParse(camelCaseKeys(model.settings));
		if (!parsed.success || Object.keys(parsed.data).length === 0) {
			logger.warn(`Ignoring unsupported settings for model '${model.id}' in nao_config.yaml`, {
				source: 'system',
			});
			continue;
		}
		settings[model.id] = parsed.data as ModelInferenceSettings;
	}

	return settings;
}

/**
 * Substitute `{{ env('NAME') }}` references, which nao_config.yaml uses to keep secrets out of
 * the file. `aws(...)` and `k8s(...)` are resolved by the CLI only, so a value that still needs
 * them is dropped in favour of the environment.
 */
function resolveSecrets(value: unknown, extraEnv: Record<string, string>): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	let resolvable = true;
	const resolved = value.replace(SECRET_PATTERN, (_match, protocol: string, identifier: string) => {
		if (protocol !== 'env') {
			resolvable = false;
			return '';
		}
		return extraEnv[identifier] || process.env[identifier] || '';
	});

	return resolvable && resolved.trim() ? resolved : null;
}

/**
 * Read the `provider` field of an entry, which is either a kind or, for the kinds that allow
 * several instances, a kind and the name given to that instance: `openai-compatible/my-vllm`.
 */
function resolveProviderName(name: string): LlmProvider | null {
	const [rawKind, ...rest] = (name ?? '').trim().split('/');
	const kind = resolveProviderKind(rawKind);
	if (!kind || rest.length === 0) {
		return kind;
	}
	if (kind !== NAMED_PROVIDER_KIND || rest.length > 1) {
		return null;
	}
	const instanceName = toProviderName(rest[0]);
	return instanceName ? toNamedProvider(instanceName) : null;
}

function resolveProviderKind(name: string): LlmProviderKind | null {
	const normalized = name.trim().toLowerCase();
	if (PROVIDER_ALIASES[normalized]) {
		return PROVIDER_ALIASES[normalized];
	}
	return (LLM_PROVIDER_NAMES as readonly string[]).includes(normalized) ? (normalized as LlmProviderKind) : null;
}

function camelCaseKeys(record: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(record).map(([key, value]) => [
			key.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase()),
			value,
		]),
	);
}

function configPath(projectPath: string): string {
	return path.join(projectPath, 'nao_config.yaml');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
