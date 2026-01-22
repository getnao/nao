import { and, eq } from 'drizzle-orm';

import s, { DBProjectLlmConfig, NewProjectLlmConfig } from '../db/abstractSchema';
import { db } from '../db/db';

export const getProjectLlmConfigs = async (projectId: string): Promise<DBProjectLlmConfig[]> => {
	return db.select().from(s.projectLlmConfig).where(eq(s.projectLlmConfig.projectId, projectId)).execute();
};

export const getProjectLlmConfigByProvider = async (
	projectId: string,
	provider: 'openai' | 'anthropic',
): Promise<DBProjectLlmConfig | null> => {
	const [config] = await db
		.select()
		.from(s.projectLlmConfig)
		.where(and(eq(s.projectLlmConfig.projectId, projectId), eq(s.projectLlmConfig.provider, provider)))
		.execute();
	return config ?? null;
};

export const upsertProjectLlmConfig = async (
	config: Omit<NewProjectLlmConfig, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<DBProjectLlmConfig> => {
	const existing = await getProjectLlmConfigByProvider(config.projectId, config.provider);

	if (existing) {
		const [updated] = await db
			.update(s.projectLlmConfig)
			.set({ apiKey: config.apiKey })
			.where(eq(s.projectLlmConfig.id, existing.id))
			.returning()
			.execute();
		return updated;
	}

	const [created] = await db.insert(s.projectLlmConfig).values(config).returning().execute();
	return created;
};

export const deleteProjectLlmConfig = async (projectId: string, provider: 'openai' | 'anthropic'): Promise<void> => {
	await db
		.delete(s.projectLlmConfig)
		.where(and(eq(s.projectLlmConfig.projectId, projectId), eq(s.projectLlmConfig.provider, provider)))
		.execute();
};
