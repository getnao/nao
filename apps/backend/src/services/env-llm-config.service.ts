import { providerLabel } from '@nao/shared/types';

import * as projectQueries from '../queries/project.queries';
import * as projectLlmConfigQueries from '../queries/project-llm-config.queries';
import { getEnvProviders } from '../utils/llm';

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

	const configs = await projectLlmConfigQueries.getAllProjectLlmConfigs(projectId);
	const configuredProviders = new Set(
		configs
			.filter((config) => config.disabledAt === null || config.credentialSource === 'env')
			.map((config) => config.provider),
	);
	let registered = 0;

	for (const provider of providers) {
		if (configuredProviders.has(provider)) {
			continue;
		}
		const created = await projectLlmConfigQueries.createEnvProjectLlmConfig(
			projectId,
			provider,
			providerLabel(provider),
		);
		if (created) {
			registered += 1;
			configuredProviders.add(provider);
		}
	}

	return registered;
}
