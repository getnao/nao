import type { LlmProvider, LlmSelectedModel } from '@nao/shared/types';
import { eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import { env } from '../env';
import { llmProviderSchema } from '../types/llm';
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

export const getProjectTelegramConfig = async (
	projectId: string,
): Promise<{
	botToken: string;
	modelSelection?: LlmSelectedModel;
} | null> => {
	const [project] = await db.select().from(s.project).where(eq(s.project.id, projectId)).execute();
	const settings = project?.telegramSettings;

	if (!settings?.telegramBotToken) {
		return null;
	}

	return {
		botToken: settings.telegramBotToken,
		modelSelection: toLlmSelectedModel(settings.telegramLlmProvider, settings.telegramLlmModelId),
	};
};

export const upsertProjectTelegramConfig = async (data: {
	projectId: string;
	botToken: string;
	modelProvider?: LlmProvider;
	modelId?: string;
}): Promise<{
	botToken: string;
	modelSelection?: LlmSelectedModel;
}> => {
	const updated = await takeFirstOrThrow(
		db
			.update(s.project)
			.set({
				telegramSettings: {
					telegramBotToken: data.botToken,
					telegramLlmProvider: data.modelProvider ?? '',
					telegramLlmModelId: data.modelId ?? '',
				},
			})
			.where(eq(s.project.id, data.projectId))
			.returning()
			.execute(),
		`Project not found: ${data.projectId}`,
	);

	const settings = updated.telegramSettings;
	return {
		botToken: settings?.telegramBotToken || '',
		modelSelection: toLlmSelectedModel(settings?.telegramLlmProvider, settings?.telegramLlmModelId),
	};
};

export const updateProjectTelegramModel = async (
	projectId: string,
	modelProvider: LlmProvider | null,
	modelId: string | null,
): Promise<void> => {
	await db.transaction(async (tx) => {
		const project = await takeFirstOrThrow(
			tx.select().from(s.project).where(eq(s.project.id, projectId)).execute(),
			`Project not found: ${projectId}`,
		);
		const existing = project.telegramSettings;

		await tx
			.update(s.project)
			.set({
				telegramSettings: {
					telegramBotToken: existing?.telegramBotToken ?? '',
					telegramLlmProvider: modelProvider ?? '',
					telegramLlmModelId: modelId ?? '',
				},
			})
			.where(eq(s.project.id, projectId))
			.execute();
	});
};

export const deleteProjectTelegramConfig = async (projectId: string): Promise<void> => {
	await db.update(s.project).set({ telegramSettings: null }).where(eq(s.project.id, projectId)).execute();
};

export interface TelegramConfig {
	projectId: string;
	botToken: string;
	redirectUrl: string;
	modelSelection?: LlmSelectedModel;
}

export async function getTelegramConfig(): Promise<TelegramConfig | null> {
	const projectPath = env.NAO_DEFAULT_PROJECT_PATH;
	if (!projectPath) {
		return null;
	}

	const [project] = await db.select().from(s.project).where(eq(s.project.path, projectPath)).execute();

	if (!project) {
		return null;
	}

	const settings = project.telegramSettings;
	const botToken = settings?.telegramBotToken;
	const redirectUrl = env.BETTER_AUTH_URL || 'http://localhost:3000/';

	if (!botToken) {
		return null;
	}

	return {
		projectId: project.id,
		botToken,
		redirectUrl,
		modelSelection: toLlmSelectedModel(settings?.telegramLlmProvider, settings?.telegramLlmModelId),
	};
}
