import { eq } from 'drizzle-orm';

import s, { DBProject } from '../db/abstractSchema';
import { db } from '../db/db';
import { env } from '../env';
import { LlmProvider, llmProviderSchema, ModelSelection } from '../types/llm';

function toModelSelection(
	provider: string | null | undefined,
	modelId: string | null | undefined,
): ModelSelection | undefined {
	if (!provider || !modelId) {
		return undefined;
	}
	const parsed = llmProviderSchema.safeParse(provider);
	return parsed.success ? { provider: parsed.data, modelId } : undefined;
}

export const getProjectSlackConfig = async (
	projectId: string,
): Promise<{
	botToken: string;
	signingSecret: string;
	modelSelection?: ModelSelection;
} | null> => {
	const [project] = await db.select().from(s.project).where(eq(s.project.id, projectId)).execute();
	const settings = project?.slackSettings;

	if (!settings?.slackBotToken || !settings?.slackSigningSecret) {
		return null;
	}

	return {
		botToken: settings.slackBotToken,
		signingSecret: settings.slackSigningSecret,
		modelSelection: toModelSelection(settings.slackllmProvider, settings.slackllmModelId),
	};
};

export const upsertProjectSlackConfig = async (data: {
	projectId: string;
	botToken: string;
	signingSecret: string;
	modelProvider?: LlmProvider;
	modelId?: string;
}): Promise<{
	botToken: string;
	signingSecret: string;
	modelSelection?: ModelSelection;
}> => {
	const [updated] = await db
		.update(s.project)
		.set({
			slackSettings: {
				slackBotToken: data.botToken,
				slackSigningSecret: data.signingSecret,
				slackllmProvider: data.modelProvider ?? '',
				slackllmModelId: data.modelId ?? '',
			},
		})
		.where(eq(s.project.id, data.projectId))
		.returning()
		.execute();

	const settings = updated.slackSettings;
	return {
		botToken: settings?.slackBotToken || '',
		signingSecret: settings?.slackSigningSecret || '',
		modelSelection: toModelSelection(settings?.slackllmProvider, settings?.slackllmModelId),
	};
};

export const updateProjectSlackModel = async (
	projectId: string,
	modelProvider: LlmProvider | null,
	modelId: string | null,
): Promise<void> => {
	await db.transaction(async (tx) => {
		const [project] = await tx.select().from(s.project).where(eq(s.project.id, projectId)).execute();
		const existing = project?.slackSettings;

		await tx
			.update(s.project)
			.set({
				slackSettings: {
					slackBotToken: existing?.slackBotToken ?? '',
					slackSigningSecret: existing?.slackSigningSecret ?? '',
					slackllmProvider: modelProvider ?? '',
					slackllmModelId: modelId ?? '',
				},
			})
			.where(eq(s.project.id, projectId))
			.execute();
	});
};

export const deleteProjectSlackConfig = async (projectId: string): Promise<void> => {
	await db.update(s.project).set({ slackSettings: null }).where(eq(s.project.id, projectId)).execute();
};

export interface SlackConfig {
	projectId: string;
	botToken: string;
	signingSecret: string;
	redirectUrl: string;
	modelSelection?: ModelSelection;
}

/**
 * Get Slack configuration from project config with env var fallbacks.
 * This is the single source of truth for all Slack config values.
 */
export async function getSlackConfig(): Promise<SlackConfig | null> {
	const projectPath = env.NAO_DEFAULT_PROJECT_PATH;
	if (!projectPath) {
		return null;
	}

	const [project] = await db.select().from(s.project).where(eq(s.project.path, projectPath)).execute();

	if (!project) {
		return null;
	}

	const settings = project.slackSettings;
	const botToken = settings?.slackBotToken;
	const signingSecret = settings?.slackSigningSecret;
	const redirectUrl = env.BETTER_AUTH_URL || 'http://localhost:3000/';

	if (!botToken || !signingSecret) {
		return null;
	}

	return {
		projectId: project.id,
		botToken,
		signingSecret,
		redirectUrl,
		modelSelection: toModelSelection(settings?.slackllmProvider, settings?.slackllmModelId),
	};
}

// Re-export DBProject for backward compatibility where needed
export type { DBProject };
