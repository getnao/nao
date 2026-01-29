import { and, eq } from 'drizzle-orm';

import s, { DBProjectLlmConfig, NewProjectLlmConfig } from '../db/abstractSchema';
import { db } from '../db/db';
import { LlmProvider } from '../types/llm';
import { getDefaultEnvProvider, getDefaultModelId } from '../utils/llm';

export const getProjectLlmConfigs = async (projectId: string): Promise<DBProjectLlmConfig[]> => {
	return db.select().from(s.projectLlmConfig).where(eq(s.projectLlmConfig.projectId, projectId)).execute();
};

export const getProjectLlmConfigByProvider = async (
	projectId: string,
	provider: LlmProvider,
): Promise<DBProjectLlmConfig | null> => {
	const [config] = await db
		.select()
		.from(s.projectLlmConfig)
		.where(and(eq(s.projectLlmConfig.projectId, projectId), eq(s.projectLlmConfig.provider, provider)))
		.execute();
	return config ?? null;
};

export const upsertProjectLlmConfig = async (
	config: Omit<NewProjectLlmConfig, 'id' | 'createdAt' | 'updatedAt'> & { apiKey: string | null },
): Promise<DBProjectLlmConfig> => {
	const existing = await getProjectLlmConfigByProvider(config.projectId, config.provider as LlmProvider);

	if (existing) {
		const [updated] = await db
			.update(s.projectLlmConfig)
			.set({
				// Only update apiKey if a new one is provided
				...(config.apiKey !== null && { apiKey: config.apiKey }),
				enabledModels: config.enabledModels,
				baseUrl: config.baseUrl,
			})
			.where(eq(s.projectLlmConfig.id, existing.id))
			.returning()
			.execute();
		return updated;
	}

	const [created] = await db
		.insert(s.projectLlmConfig)
		.values({ ...config, apiKey: config.apiKey })
		.returning()
		.execute();
	return created;
};

export const deleteProjectLlmConfig = async (projectId: string, provider: LlmProvider): Promise<void> => {
	await db
		.delete(s.projectLlmConfig)
		.where(and(eq(s.projectLlmConfig.projectId, projectId), eq(s.projectLlmConfig.provider, provider)))
		.execute();
};

/** Get the provider for a project (for display purposes) */
export const getProjectModelProvider = async (projectId: string): Promise<LlmProvider | undefined> => {
	const configs = await getProjectLlmConfigs(projectId);

	// Return first configured provider, preferring anthropic
	const anthropicConfig = configs.find((c) => c.provider === 'anthropic');
	if (anthropicConfig) return 'anthropic';

	const openaiConfig = configs.find((c) => c.provider === 'openai');
	if (openaiConfig) return 'openai';

	// Fall back to env providers
	return getDefaultEnvProvider();
};

/** Get the config to use for a specific model selection */
export const getProjectLlmConfigForModel = async (
	projectId: string,
	provider: LlmProvider,
	modelId: string,
): Promise<{ config: DBProjectLlmConfig; modelId: string } | null> => {
	const config = await getProjectLlmConfigByProvider(projectId, provider);
	if (!config) return null;

	// Check if the model is enabled, or use default if no models enabled
	const enabledModels = config.enabledModels ?? [];
	const isModelEnabled = enabledModels.length === 0 || enabledModels.includes(modelId);

	if (!isModelEnabled) {
		// Model not enabled, use the first enabled model or default
		const fallbackModel = enabledModels[0] ?? getDefaultModelId(provider);
		return { config, modelId: fallbackModel };
	}

	return { config, modelId };
};
