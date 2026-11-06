import { providerLabel } from '@nao/shared/types';

import * as projectQueries from '../queries/project.queries';
import * as projectLlmConfigQueries from '../queries/project-llm-config.queries';
import { getEnvProviders, getProjectConfigLlm } from '../utils/llm';

export async function registerEnvLlmConfigsForAllProjects(): Promise<number> {
	let registered = 0;
	for (const projectId of await projectQueries.listProjectIds()) {
		registered += await registerEnvLlmConfigs(projectId);
	}
	return registered;
}

export async function registerEnvLlmConfigs(projectId: string): Promise<number> {
	const providers = getEnvProviders();
	if (providers.length === 0) {
		return 0;
	}

	const [configs, configLlm] = await Promise.all([
		projectLlmConfigQueries.getAllProjectLlmConfigs(projectId),
		getProjectConfigLlm(projectId),
	]);
	const configuredProviders = new Set(
		configs
			.filter((config) => config.disabledAt === null || config.credentialSource === 'env')
			.map((config) => config.provider),
	);
	const yamlProviders = new Set(configLlm?.providers.map((provider) => provider.provider) ?? []);
	const usedNames = new Set(configs.map((config) => config.name));
	let registered = 0;

	for (const provider of providers) {
		if (configuredProviders.has(provider) || yamlProviders.has(provider)) {
			continue;
		}
		const name = availableEnvConfigName(providerLabel(provider), usedNames);
		const created = await projectLlmConfigQueries.createEnvProjectLlmConfig(projectId, provider, name);
		if (created) {
			registered += 1;
			configuredProviders.add(provider);
			usedNames.add(name);
		}
	}

	return registered;
}

function availableEnvConfigName(baseName: string, usedNames: Set<string>): string {
	if (!usedNames.has(baseName)) {
		return baseName;
	}
	const envName = `${baseName} (ENV)`;
	if (!usedNames.has(envName)) {
		return envName;
	}
	let suffix = 2;
	while (usedNames.has(`${envName} ${suffix}`)) {
		suffix += 1;
	}
	return `${envName} ${suffix}`;
}
