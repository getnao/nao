import { eq } from 'drizzle-orm';

import s, { DBProject, DBProjectSlackConfig, NewProjectSlackConfig } from '../db/abstractSchema';
import { db } from '../db/db';

export interface ProjectWithSlackConfig {
	project: DBProject;
	slackConfig: DBProjectSlackConfig | null;
}

export const getProjectSlackConfigByPath = async (projectPath: string): Promise<ProjectWithSlackConfig | null> => {
	const results = await db
		.select({
			project: s.project,
			slackConfig: s.projectSlackConfig,
		})
		.from(s.project)
		.leftJoin(s.projectSlackConfig, eq(s.project.id, s.projectSlackConfig.projectId))
		.where(eq(s.project.path, projectPath))
		.execute();

	const row = results[0];
	if (!row) {
		return null;
	}

	return {
		project: row.project,
		slackConfig: row.slackConfig,
	};
};

export const getProjectSlackConfig = async (projectId: string): Promise<DBProjectSlackConfig | null> => {
	const [config] = await db
		.select()
		.from(s.projectSlackConfig)
		.where(eq(s.projectSlackConfig.projectId, projectId))
		.execute();
	return config ?? null;
};

export const upsertProjectSlackConfig = async (
	config: Omit<NewProjectSlackConfig, 'id' | 'createdAt' | 'updatedAt' | 'postMessageUrl'>,
): Promise<DBProjectSlackConfig> => {
	const existing = await getProjectSlackConfig(config.projectId);

	if (existing) {
		const [updated] = await db
			.update(s.projectSlackConfig)
			.set({
				botToken: config.botToken,
				signingSecret: config.signingSecret,
			})
			.where(eq(s.projectSlackConfig.id, existing.id))
			.returning()
			.execute();
		return updated;
	}

	const [created] = await db.insert(s.projectSlackConfig).values(config).returning().execute();
	return created;
};

export const deleteProjectSlackConfig = async (projectId: string): Promise<void> => {
	await db.delete(s.projectSlackConfig).where(eq(s.projectSlackConfig.projectId, projectId)).execute();
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

	const result = await getProjectSlackConfigByPath(projectPath);
	if (!result) {
		return null;
	}

	const { project, slackConfig } = result;

	const botToken = slackConfig?.botToken || process.env.SLACK_BOT_TOKEN;
	const signingSecret = slackConfig?.signingSecret || process.env.SLACK_SIGNING_SECRET;
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
