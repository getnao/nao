import type { LlmProvider, LlmSelectedModel } from '@nao/shared/types';
import { eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import { env } from '../env';
import { llmProviderSchema } from '../types/llm';
import type { MattermostSettings } from '../types/messaging-provider';
import { takeFirstOrThrow } from '../utils/queries';

export const getProjectMattermostConfig = async (projectId: string): Promise<MattermostConfig | null> => {
	const [project] = await db.select().from(s.project).where(eq(s.project.id, projectId)).execute();
	return project ? toMattermostConfig(project.id, project.mattermostSettings) : null;
};

export const upsertProjectMattermostConfig = async (data: {
	projectId: string;
	baseUrl: string;
	botToken: string;
	modelProvider?: LlmProvider;
	modelId?: string;
	interactiveButtonsEnabled?: boolean;
	callbackUrl?: string;
}): Promise<MattermostConfig> => {
	const updated = await takeFirstOrThrow(
		db
			.update(s.project)
			.set({
				mattermostSettings: {
					mattermostBaseUrl: data.baseUrl,
					mattermostBotToken: data.botToken,
					mattermostLlmProvider: data.modelProvider ?? '',
					mattermostLlmModelId: data.modelId ?? '',
					mattermostInteractiveButtonsEnabled: data.interactiveButtonsEnabled ?? true,
					mattermostCallbackUrl: data.callbackUrl || undefined,
				},
			})
			.where(eq(s.project.id, data.projectId))
			.returning()
			.execute(),
		`Project not found: ${data.projectId}`,
	);

	const config = toMattermostConfig(updated.id, updated.mattermostSettings);
	if (!config) {
		throw new Error(`Mattermost configuration not found after update: ${data.projectId}`);
	}
	return config;
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
					mattermostInteractiveButtonsEnabled: existing?.mattermostInteractiveButtonsEnabled ?? true,
					mattermostCallbackUrl: existing?.mattermostCallbackUrl,
				},
			})
			.where(eq(s.project.id, projectId))
			.execute();
	});
};

export const deleteProjectMattermostConfig = async (projectId: string): Promise<void> => {
	await db.update(s.project).set({ mattermostSettings: null }).where(eq(s.project.id, projectId)).execute();
};

export const listProjectsWithMattermostEnabled = async (): Promise<MattermostConfig[]> => {
	const projects = await db.select().from(s.project).execute();
	return projects
		.map((project) => toMattermostConfig(project.id, project.mattermostSettings))
		.filter((config): config is MattermostConfig => config !== null);
};

function toMattermostConfig(
	projectId: string,
	settings: MattermostSettings | null | undefined,
): MattermostConfig | null {
	if (!settings?.mattermostBaseUrl || !settings.mattermostBotToken) {
		return null;
	}

	return {
		projectId,
		baseUrl: settings.mattermostBaseUrl,
		botToken: settings.mattermostBotToken,
		redirectUrl: env.BETTER_AUTH_URL || 'http://localhost:3000/',
		modelSelection: toLlmSelectedModel(settings.mattermostLlmProvider, settings.mattermostLlmModelId),
		interactiveButtonsEnabled: settings.mattermostInteractiveButtonsEnabled ?? true,
		callbackUrl: settings.mattermostCallbackUrl,
	};
}

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

export interface MattermostConfig {
	projectId: string;
	baseUrl: string;
	botToken: string;
	redirectUrl: string;
	modelSelection?: LlmSelectedModel;
	interactiveButtonsEnabled: boolean;
	callbackUrl?: string;
}
