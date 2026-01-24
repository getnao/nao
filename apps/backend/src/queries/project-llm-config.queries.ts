import { and, eq } from 'drizzle-orm';

import s, { DBProjectLlmConfig, NewProjectLlmConfig } from '../db/abstractSchema';
import { db } from '../db/db';
import { LlmProvider } from '../types/chat';

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

export const getProjectModelProvider = async (projectId: string): Promise<LlmProvider | undefined> => {
	const configs = await getProjectLlmConfigs(projectId);
	const hasAnthropic = configs.some((c) => c.provider === 'anthropic') || !!process.env.ANTHROPIC_API_KEY;
	const hasOpenai = configs.some((c) => c.provider === 'openai') || !!process.env.OPENAI_API_KEY;
	if (hasAnthropic) return 'anthropic';
	if (hasOpenai) return 'openai';
	return undefined;
};
