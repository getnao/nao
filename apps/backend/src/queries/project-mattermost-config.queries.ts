import type { LlmProvider, LlmSelectedModel } from '@nao/shared/types';
import { eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import { env } from '../env';
import { llmProviderSchema } from '../types/llm';
import { MatterMostReplyMode } from '../types/messaging-provider';
import { takeFirstOrThrow } from '../utils/queries';

function toLlmSelectedModel(
	provider: string | null | undefined,
	modelId: string | null | undefined,
): LlmSelectedModel | undefined {
	if (!provider || !modelId) {
		return undefined;
	}
	const parsed = llmProviderSchema.safeParse(provider);
	return parsed.success ? { provider: parsed.data, modelId } : undefined;
}

export const listMattermostConfigs = async (): Promise<MatterMostConfig[]> => {
	const projects = await db.select().from(s.project).execute();
	const configs: MatterMostConfig[] = [];
	for (const project of projects) {
		const settings = project.mattermostSettings;
		if (!settings?.mattermostBaseUrl || !settings?.mattermostBotToken) {
			continue;
		}
		configs.push({
			projectId: project.id,
			baseUrl: settings.mattermostBaseUrl,
			botToken: settings.mattermostBotToken,
			redirectUrl: env.BETTER_AUTH_URL || 'http://localhost:3000/',
			replyMode: 'thread',
			modelSelection: toLlmSelectedModel(settings.mattermostLlmProvider, settings.mattermostLlmModelId),
		});
	}
	return configs;
};

export const getProjectMattermostConfig = async (projectId: string): Promise<MatterMostConfig | null> => {
	const [project] = await db.select().from(s.project).where(eq(s.project.id, projectId)).execute();
	const settings = project?.mattermostSettings;

	if (!settings?.mattermostBaseUrl || !settings?.mattermostBotToken) {
		return null;
	}

	return {
		projectId,
		baseUrl: settings.mattermostBaseUrl,
		botToken: settings.mattermostBotToken,
		redirectUrl: env.BETTER_AUTH_URL || 'http://localhost:3000/',
		replyMode: 'thread',
		modelSelection: toLlmSelectedModel(settings.mattermostLlmProvider, settings.mattermostLlmModelId),
	};
};

export const upsertProjectMattermostConfig = async (data: {
	projectId: string;
	baseUrl: string;
	botToken: string;
	modelProvider?: LlmProvider;
	modelId?: string;
}): Promise<{
	baseUrl: string;
	botToken: string;
	modelSelection?: LlmSelectedModel;
}> => {
	const updated = await takeFirstOrThrow(
		db
			.update(s.project)
			.set({
				mattermostSettings: {
					mattermostBaseUrl: data.baseUrl,
					mattermostBotToken: data.botToken,
					mattermostLlmProvider: data.modelProvider ?? '',
					mattermostLlmModelId: data.modelId ?? '',
				},
			})
			.where(eq(s.project.id, data.projectId))
			.returning()
			.execute(),
		`Project not found: ${data.projectId}`,
	);

	const settings = updated.mattermostSettings;
	return {
		baseUrl: settings?.mattermostBaseUrl || '',
		botToken: settings?.mattermostBotToken || '',
		modelSelection: toLlmSelectedModel(settings?.mattermostLlmProvider, settings?.mattermostLlmModelId),
	};
};

export const updateProjectMattermostModel = async (
	projectId: string,
	modelProvider: LlmProvider | null,
	modelId: string | null,
): Promise<void> => {
	await db.transaction(async (tx) => {
		const project = await takeFirstOrThrow(
			tx.select().from(s.project).where(eq(s.project.id, projectId)).execute(),
			`Project not found: ${projectId}`,
		);
		const existing = project.mattermostSettings;

		await tx
			.update(s.project)
			.set({
				mattermostSettings: {
					mattermostBaseUrl: existing?.mattermostBaseUrl ?? '',
					mattermostBotToken: existing?.mattermostBotToken ?? '',
					mattermostLlmProvider: modelProvider ?? '',
					mattermostLlmModelId: modelId ?? '',
				},
			})
			.where(eq(s.project.id, projectId))
			.execute();
	});
};

export const deleteProjectMattermostConfig = async (projectId: string): Promise<void> => {
	await db.update(s.project).set({ mattermostSettings: null }).where(eq(s.project.id, projectId)).execute();
};

export interface MatterMostConfig {
	projectId: string;
	botToken: string;
	baseUrl: string;
	redirectUrl: string;
	replyMode: MatterMostReplyMode;
	modelSelection?: LlmSelectedModel;
}
