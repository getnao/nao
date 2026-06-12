import type { LlmProvider, LlmSelectedModel } from '@nao/shared/types';
import { eq } from 'drizzle-orm';

import s, { DBProject } from '../db/abstractSchema';
import { db } from '../db/db';
import { env } from '../env';
import { llmProviderSchema } from '../types/llm';
import { SlackReplyMode, SlackTransportMode } from '../types/messaging-provider';
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

export const getProjectSlackConfig = async (projectId: string): Promise<SlackConfig | null> => {
	const [project] = await db.select().from(s.project).where(eq(s.project.id, projectId)).execute();
	const settings = project?.slackSettings;

	if (!settings?.slackBotToken) {
		return null;
	}

	const transportMode: SlackTransportMode = settings.slackTransportMode === 'socket' ? 'socket' : 'webhook';

	if (transportMode === 'webhook' && !settings.slackSigningSecret) {
		return null;
	}
	if (transportMode === 'socket' && !settings.slackAppToken) {
		return null;
	}

	return {
		projectId,
		botToken: settings.slackBotToken,
		signingSecret: settings.slackSigningSecret ?? '',
		redirectUrl: env.BETTER_AUTH_URL || 'http://localhost:3000/',
		modelSelection: toLlmSelectedModel(settings.slackllmProvider, settings.slackllmModelId),
		autoCreateUsersEnabled: settings.autoCreateUsersEnabled ?? false,
		autoCreateUsersDomains: settings.autoCreateUsersDomains ?? [],
		transportMode,
		appToken: settings.slackAppToken ?? '',
		replyMode: toSlackReplyMode(settings.slackReplyMode),
	};
};

export const upsertProjectSlackConfig = async (data: {
	projectId: string;
	botToken: string;
	signingSecret: string;
	transportMode: SlackTransportMode;
	appToken?: string;
	modelProvider?: LlmProvider;
	modelId?: string;
}): Promise<{
	botToken: string;
	signingSecret: string;
	transportMode: SlackTransportMode;
	appToken: string;
	modelSelection?: LlmSelectedModel;
	replyMode: SlackReplyMode;
}> => {
	const updated = await db.transaction(async (tx) => {
		const project = await takeFirstOrThrow(
			tx.select().from(s.project).where(eq(s.project.id, data.projectId)).execute(),
			`Project not found: ${data.projectId}`,
		);
		const existing = project.slackSettings;

		return takeFirstOrThrow(
			tx
				.update(s.project)
				.set({
					slackSettings: {
						slackBotToken: data.botToken,
						slackSigningSecret: data.signingSecret,
						slackllmProvider: data.modelProvider ?? '',
						slackllmModelId: data.modelId ?? '',
						autoCreateUsersEnabled: existing?.autoCreateUsersEnabled ?? false,
						autoCreateUsersDomains: existing?.autoCreateUsersDomains ?? [],
						slackTransportMode: data.transportMode,
						slackAppToken: data.appToken ?? '',
						slackReplyMode: toSlackReplyMode(existing?.slackReplyMode),
					},
				})
				.where(eq(s.project.id, data.projectId))
				.returning()
				.execute(),
			`Project not found: ${data.projectId}`,
		);
	});

	const settings = updated.slackSettings;
	return {
		botToken: settings?.slackBotToken || '',
		signingSecret: settings?.slackSigningSecret || '',
		transportMode: settings?.slackTransportMode === 'socket' ? 'socket' : 'webhook',
		appToken: settings?.slackAppToken || '',
		modelSelection: toLlmSelectedModel(settings?.slackllmProvider, settings?.slackllmModelId),
		replyMode: toSlackReplyMode(settings?.slackReplyMode),
	};
};

export const updateProjectSlackModel = async (
	projectId: string,
	modelProvider: LlmProvider | null,
	modelId: string | null,
): Promise<void> => {
	await db.transaction(async (tx) => {
		const project = await takeFirstOrThrow(
			tx.select().from(s.project).where(eq(s.project.id, projectId)).execute(),
			`Project not found: ${projectId}`,
		);
		const existing = project.slackSettings;

		await tx
			.update(s.project)
			.set({
				slackSettings: {
					slackBotToken: existing?.slackBotToken ?? '',
					slackSigningSecret: existing?.slackSigningSecret ?? '',
					slackllmProvider: modelProvider ?? '',
					slackllmModelId: modelId ?? '',
					autoCreateUsersEnabled: existing?.autoCreateUsersEnabled ?? false,
					autoCreateUsersDomains: existing?.autoCreateUsersDomains ?? [],
					slackTransportMode: existing?.slackTransportMode ?? 'webhook',
					slackAppToken: existing?.slackAppToken ?? '',
					slackReplyMode: toSlackReplyMode(existing?.slackReplyMode),
				},
			})
			.where(eq(s.project.id, projectId))
			.execute();
	});
};

export const updateProjectSlackReplyMode = async (projectId: string, replyMode: SlackReplyMode): Promise<void> => {
	await db.transaction(async (tx) => {
		const project = await takeFirstOrThrow(
			tx.select().from(s.project).where(eq(s.project.id, projectId)).execute(),
			`Project not found: ${projectId}`,
		);
		const existing = project.slackSettings;
		if (!existing) {
			throw new Error(`Slack is not configured for project ${projectId}`);
		}

		await tx
			.update(s.project)
			.set({
				slackSettings: {
					...existing,
					slackReplyMode: replyMode,
				},
			})
			.where(eq(s.project.id, projectId))
			.execute();
	});
};

export const updateProjectSlackAutoCreateUsers = async (
	projectId: string,
	enabled: boolean,
	domains: string[],
): Promise<void> => {
	await db.transaction(async (tx) => {
		const project = await takeFirstOrThrow(
			tx.select().from(s.project).where(eq(s.project.id, projectId)).execute(),
			`Project not found: ${projectId}`,
		);
		const existing = project.slackSettings;
		if (!existing) {
			throw new Error(`Slack is not configured for project ${projectId}`);
		}

		await tx
			.update(s.project)
			.set({
				slackSettings: {
					...existing,
					autoCreateUsersEnabled: enabled,
					autoCreateUsersDomains: domains,
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
	modelSelection?: LlmSelectedModel;
	autoCreateUsersEnabled: boolean;
	autoCreateUsersDomains: string[];
	transportMode: SlackTransportMode;
	appToken: string;
	replyMode: SlackReplyMode;
}

export const listSocketModeSlackConfigs = async (): Promise<SlackConfig[]> => {
	const projects = await db.select().from(s.project).execute();
	const configs: SlackConfig[] = [];
	for (const project of projects) {
		const settings = project.slackSettings;
		if (!settings?.slackBotToken || settings.slackTransportMode !== 'socket' || !settings.slackAppToken) {
			continue;
		}
		configs.push({
			projectId: project.id,
			botToken: settings.slackBotToken,
			signingSecret: settings.slackSigningSecret ?? '',
			redirectUrl: env.BETTER_AUTH_URL || 'http://localhost:3000/',
			modelSelection: toLlmSelectedModel(settings.slackllmProvider, settings.slackllmModelId),
			autoCreateUsersEnabled: settings.autoCreateUsersEnabled ?? false,
			autoCreateUsersDomains: settings.autoCreateUsersDomains ?? [],
			transportMode: 'socket',
			appToken: settings.slackAppToken,
			replyMode: toSlackReplyMode(settings.slackReplyMode),
		});
	}
	return configs;
};

function toSlackReplyMode(replyMode: string | null | undefined): SlackReplyMode {
	return replyMode === 'mention' ? 'mention' : 'thread';
}

// Re-export DBProject for backward compatibility where needed
export type { DBProject };
