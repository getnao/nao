import { z } from 'zod/v4';

import { DECISION_PROVIDER_META, parseDecisionProvider } from '../agents/decision.providers';
import type { DecisionModel, DecisionProvider } from '../types/decision';
import { logger } from './logger';
import { loadConfigBlock, resolveSecrets } from './nao-config-llm';

/** A `decision` provider entry of nao_config.yaml, shaped like the rows of `project_decision_config`. */
export type ConfigDecisionProvider = {
	provider: DecisionProvider;
	apiKey: string | null;
	baseUrl: string | null;
	credentials: Record<string, string> | null;
};

export type ConfigDecision = {
	providers: ConfigDecisionProvider[];
	model: DecisionModel | null;
};

const providerSchema = z.looseObject({
	provider: z.string(),
	api_key: z.string().nullish(),
	base_url: z.string().nullish(),
});

const decisionSchema = z.object({
	providers: z.array(providerSchema).nullish(),
	model: z.string().nullish(),
});

type RawProvider = z.infer<typeof providerSchema>;

/**
 * Read the `decision` block of a project's nao_config.yaml. Returns null when the project has no
 * config file, no `decision` block, or one nao cannot make sense of.
 */
export function readProjectConfigDecision(
	projectPath: string,
	extraEnv: Record<string, string> = {},
): ConfigDecision | null {
	const raw = loadConfigBlock(projectPath, 'decision');
	if (!raw) {
		return null;
	}

	const parsed = decisionSchema.safeParse(raw);
	if (!parsed.success) {
		logger.warn(`Ignoring the \`decision\` block of nao_config.yaml: ${parsed.error.message}`, {
			source: 'system',
		});
		return null;
	}

	return {
		providers: (parsed.data.providers ?? []).flatMap((provider) => toConfigProvider(provider, extraEnv)),
		model: parseDecisionModel(parsed.data.model),
	};
}

function toConfigProvider(raw: RawProvider, extraEnv: Record<string, string>): ConfigDecisionProvider[] {
	const provider = parseDecisionProvider(raw.provider);
	if (!provider) {
		logger.warn(`Ignoring unknown decision provider '${raw.provider}' in nao_config.yaml`, { source: 'system' });
		return [];
	}

	const credentials = Object.fromEntries(
		(DECISION_PROVIDER_META[provider].extraFields ?? [])
			.map((field) => [field.name, resolveSecrets(raw[toSnakeCase(field.name)], extraEnv)] as const)
			.filter((entry): entry is [string, string] => entry[1] !== null),
	);

	return [
		{
			provider,
			apiKey: resolveSecrets(raw.api_key, extraEnv),
			baseUrl: resolveSecrets(raw.base_url, extraEnv),
			credentials: Object.keys(credentials).length > 0 ? credentials : null,
		},
	];
}

/** A model is written `provider/model-id`, and a model id may itself hold slashes. */
function parseDecisionModel(value: string | null | undefined): DecisionModel | null {
	const separator = value?.indexOf('/') ?? -1;
	if (!value || separator <= 0) {
		return null;
	}
	const provider = parseDecisionProvider(value.slice(0, separator));
	const modelId = value.slice(separator + 1).trim();
	return provider && modelId ? { provider, modelId } : null;
}

function toSnakeCase(name: string): string {
	return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
