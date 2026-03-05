import { eq } from 'drizzle-orm';

import s, { DBProject } from '../db/abstractSchema';
import { db } from '../db/db';
import { env } from '../env';
import { LlmProvider } from '../types/llm';

export const getProjectSlackConfig = async (
	projectId: string,
): Promise<{
	botToken: string;
	signingSecret: string;
	modelSelection?: { provider: LlmProvider; modelId: string };
} | null> => {
	const [project] = await db.select().from(s.project).where(eq(s.project.id, projectId)).execute();

	if (!project?.slackBotToken || !project?.slackSigningSecret) {
		return null;
	}

	return {
		botToken: project.slackBotToken,
		signingSecret: project.slackSigningSecret,
		modelSelection:
			project.slackllmProvider && project.slackllmModelId
				? { provider: project.slackllmProvider as LlmProvider, modelId: project.slackllmModelId }
				: undefined,
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
	modelSelection?: { provider: LlmProvider; modelId: string };
}> => {
	const [updated] = await db
		.update(s.project)
		.set({
			slackBotToken: data.botToken,
			slackSigningSecret: data.signingSecret,
			slackllmProvider: data.modelProvider ?? null,
			slackllmModelId: data.modelId ?? null,
		})
		.where(eq(s.project.id, data.projectId))
		.returning()
		.execute();

	return {
		botToken: updated.slackBotToken!,
		signingSecret: updated.slackSigningSecret!,
		modelSelection:
			updated.slackllmProvider && updated.slackllmModelId
				? { provider: updated.slackllmProvider as LlmProvider, modelId: updated.slackllmModelId }
				: undefined,
	};
};

export const updateProjectSlackModel = async (
	projectId: string,
	modelProvider: LlmProvider | null,
	modelId: string | null,
): Promise<void> => {
	await db
		.update(s.project)
		.set({ slackllmProvider: modelProvider, slackllmModelId: modelId })
		.where(eq(s.project.id, projectId))
		.execute();
};

export const deleteProjectSlackConfig = async (projectId: string): Promise<void> => {
	await db
		.update(s.project)
		.set({
			slackBotToken: null,
			slackSigningSecret: null,
		})
		.where(eq(s.project.id, projectId))
		.execute();
};

export interface SlackConfig {
	projectId: string;
	botToken: string;
	signingSecret: string;
	redirectUrl: string;
	modelSelection?: { provider: LlmProvider; modelId: string };
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

	const botToken = project.slackBotToken;
	const signingSecret = project.slackSigningSecret;
	const redirectUrl = env.BETTER_AUTH_URL || 'http://localhost:3000/';

	if (!botToken || !signingSecret) {
		return null;
	}

	return {
		projectId: project.id,
		botToken,
		signingSecret,
		redirectUrl,
		modelSelection:
			project.slackllmProvider && project.slackllmModelId
				? { provider: project.slackllmProvider as LlmProvider, modelId: project.slackllmModelId }
				: undefined,
	};
}

// Re-export DBProject for backward compatibility where needed
export type { DBProject };
