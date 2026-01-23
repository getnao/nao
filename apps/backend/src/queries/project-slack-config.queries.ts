import { eq } from 'drizzle-orm';

import s, { DBProject } from '../db/abstractSchema';
import { db } from '../db/db';

export const getProjectSlackConfig = async (
	projectId: string,
): Promise<{ botToken: string; signingSecret: string } | null> => {
	const [project] = await db.select().from(s.project).where(eq(s.project.id, projectId)).execute();

	if (!project?.slackBotToken || !project?.slackSigningSecret) {
		return null;
	}

	return {
		botToken: project.slackBotToken,
		signingSecret: project.slackSigningSecret,
	};
};

export const upsertProjectSlackConfig = async (data: {
	projectId: string;
	botToken: string;
	signingSecret: string;
}): Promise<{ botToken: string; signingSecret: string }> => {
	const [updated] = await db
		.update(s.project)
		.set({
			slackBotToken: data.botToken,
			slackSigningSecret: data.signingSecret,
		})
		.where(eq(s.project.id, data.projectId))
		.returning()
		.execute();

	return {
		botToken: updated.slackBotToken!,
		signingSecret: updated.slackSigningSecret!,
	};
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
}

/**
 * Get Slack configuration from project config with env var fallbacks.
 * This is the single source of truth for all Slack config values.
 */
export async function getSlackConfig(): Promise<SlackConfig | null> {
	const projectPath = process.env.NAO_DEFAULT_PROJECT_PATH;
	if (!projectPath) {
		return null;
	}

	const [project] = await db.select().from(s.project).where(eq(s.project.path, projectPath)).execute();

	if (!project) {
		return null;
	}

	const botToken = project.slackBotToken || process.env.SLACK_BOT_TOKEN;
	const signingSecret = project.slackSigningSecret || process.env.SLACK_SIGNING_SECRET;
	const redirectUrl = process.env.REDIRECT_URL || 'http://localhost:3000/';

	if (!botToken || !signingSecret) {
		return null;
	}

	const baseUrl = redirectUrl.endsWith('/') ? redirectUrl.slice(0, -1) : redirectUrl;

	return {
		projectId: project.id,
		botToken,
		signingSecret,
		redirectUrl: `${baseUrl}/p/${project.id}/`,
	};
}

// Re-export DBProject for backward compatibility where needed
export type { DBProject };
