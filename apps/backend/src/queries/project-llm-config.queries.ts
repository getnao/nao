import type { LlmProvider } from '@nao/shared/types';
import { and, asc, eq, isNull } from 'drizzle-orm';

import s, { DBProjectLlmConfig, NewProjectLlmConfig } from '../db/abstractSchema';
import { db } from '../db/db';
import { getDefaultEnvProvider, getDefaultModelId, getProjectAvailableModels } from '../utils/llm';

export const getProjectLlmConfigs = async (projectId: string): Promise<DBProjectLlmConfig[]> => {
	return db
		.select()
		.from(s.projectLlmConfig)
		.where(and(eq(s.projectLlmConfig.projectId, projectId), isNull(s.projectLlmConfig.disabledAt)))
		.orderBy(asc(s.projectLlmConfig.createdAt))
		.execute();
};

export const getAllProjectLlmConfigs = async (projectId: string): Promise<DBProjectLlmConfig[]> => {
	return db
		.select()
		.from(s.projectLlmConfig)
		.where(eq(s.projectLlmConfig.projectId, projectId))
		.orderBy(asc(s.projectLlmConfig.createdAt))
		.execute();
};

export const createEnvProjectLlmConfig = async (
	projectId: string,
	provider: LlmProvider,
	name: string,
): Promise<boolean> => {
	const created = await db
		.insert(s.projectLlmConfig)
		.values({
			projectId,
			name,
			provider,
			credentialSource: 'env',
			apiKey: '',
			enabledModels: [],
			customModels: [],
			modelSettings: {},
		})
		.onConflictDoNothing()
		.returning({ id: s.projectLlmConfig.id })
		.execute();
	return created.length > 0;
};

export const getProjectLlmConfigById = async (
	projectId: string,
	configId: string,
): Promise<DBProjectLlmConfig | null> => {
	const [config] = await db
		.select()
		.from(s.projectLlmConfig)
		.where(
			and(
				eq(s.projectLlmConfig.projectId, projectId),
				eq(s.projectLlmConfig.id, configId),
				isNull(s.projectLlmConfig.disabledAt),
			),
		)
		.execute();
	return config ?? null;
};

export const getProjectLlmConfigByProvider = async (
	projectId: string,
	provider: LlmProvider,
): Promise<DBProjectLlmConfig | null> => {
	const [config] = await db
		.select()
		.from(s.projectLlmConfig)
		.where(
			and(
				eq(s.projectLlmConfig.projectId, projectId),
				eq(s.projectLlmConfig.provider, provider),
				isNull(s.projectLlmConfig.disabledAt),
			),
		)
		.orderBy(asc(s.projectLlmConfig.createdAt))
		.execute();
	return config ?? null;
};

export const upsertProjectLlmConfig = async (
	config: Omit<NewProjectLlmConfig, 'id' | 'createdAt' | 'updatedAt' | 'name'> & {
		name?: string;
		apiKey: string | null;
	},
): Promise<DBProjectLlmConfig> => {
	const existing = await getProjectLlmConfigByProvider(config.projectId, config.provider as LlmProvider);

	if (existing) {
		const [updated] = await db
			.update(s.projectLlmConfig)
			.set({
				...(config.name !== undefined && { name: config.name }),
				...(config.credentialSource !== undefined && { credentialSource: config.credentialSource }),
				...(config.apiKey !== null && { apiKey: config.apiKey }),
				...(config.credentials !== undefined && { credentials: config.credentials }),
				enabledModels: config.enabledModels,
				customModels: config.customModels,
				...(config.modelSettings !== undefined && { modelSettings: config.modelSettings }),
				baseUrl: config.baseUrl,
			})
			.where(eq(s.projectLlmConfig.id, existing.id))
			.returning()
			.execute();
		return updated;
	}

	const [created] = await db
		.insert(s.projectLlmConfig)
		.values({ ...config, name: config.name ?? String(config.provider), apiKey: config.apiKey })
		.returning()
		.execute();
	return created;
};

export const saveProjectLlmConfig = async (
	config: Omit<NewProjectLlmConfig, 'id' | 'createdAt' | 'updatedAt' | 'disabledAt'> & {
		apiKey: string | null;
	},
	configId?: string,
): Promise<DBProjectLlmConfig> => {
	const existing = configId ? await getProjectLlmConfigById(config.projectId, configId) : null;
	if (configId && !existing) {
		throw new Error('LLM credential not found.');
	}
	if (existing) {
		const [updated] = await db
			.update(s.projectLlmConfig)
			.set({
				name: config.name,
				provider: config.provider,
				credentialSource: config.credentialSource,
				...(config.apiKey !== null && { apiKey: config.apiKey }),
				credentials: config.credentials,
				enabledModels: config.enabledModels,
				customModels: config.customModels,
				modelSettings: config.modelSettings,
				baseUrl: config.baseUrl,
				disabledAt: null,
				updatedAt: new Date(),
			})
			.where(eq(s.projectLlmConfig.id, existing.id))
			.returning()
			.execute();
		return updated;
	}

	const [created] = await db
		.insert(s.projectLlmConfig)
		.values({ ...config, apiKey: config.apiKey ?? '' })
		.returning()
		.execute();
	return created;
};

export const deactivateProjectLlmConfig = async (projectId: string, configId: string): Promise<void> => {
	await db
		.update(s.projectLlmConfig)
		.set({ disabledAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(s.projectLlmConfig.projectId, projectId),
				eq(s.projectLlmConfig.id, configId),
				isNull(s.projectLlmConfig.disabledAt),
			),
		)
		.execute();
};

export const deleteProjectLlmConfig = async (projectId: string, provider: LlmProvider): Promise<void> => {
	await db
		.update(s.projectLlmConfig)
		.set({ disabledAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(s.projectLlmConfig.projectId, projectId),
				eq(s.projectLlmConfig.provider, provider),
				isNull(s.projectLlmConfig.disabledAt),
			),
		)
		.execute();
};

/** Get the provider for a project (for display purposes) */
export const getProjectModelProvider = async (projectId: string): Promise<LlmProvider | undefined> => {
	const configs = await getProjectLlmConfigs(projectId);

	// Return first configured provider, preferring anthropic
	const anthropicConfig = configs.find((c) => c.provider === 'anthropic');
	if (anthropicConfig) {
		return 'anthropic';
	}

	const openaiConfig = configs.find((c) => c.provider === 'openai');
	if (openaiConfig) {
		return 'openai';
	}

	// Fall back to env providers, then to whatever the project can still reach (e.g. nao-managed access)
	return getDefaultEnvProvider() ?? (await getProjectAvailableModels(projectId)).at(0)?.provider;
};

/** Get the config to use for a specific model selection */
export const getProjectLlmConfigForModel = async (
	projectId: string,
	provider: LlmProvider,
	modelId: string,
): Promise<{ config: DBProjectLlmConfig; modelId: string } | null> => {
	const config = await getProjectLlmConfigByProvider(projectId, provider);
	if (!config) {
		return null;
	}

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
