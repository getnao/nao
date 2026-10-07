import type { LlmProvider, LlmSelectedModel } from '@nao/shared/types';
import { eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import { env } from '../env';
import { llmProviderSchema } from '../types/llm';
import type { DiscordSettings } from '../types/messaging-provider';
import { takeFirstOrThrow } from '../utils/queries';

const lockForUpdate = <Query extends { execute(): unknown }>(query: Query): Query =>
	dbConfig.dialect === Dialect.Postgres ? (query as Query & Lockable<Query>).for('update') : query;

type Lockable<Query> = { for(strength: 'update'): Query };

export const getProjectDiscordConfig = async (projectId: string): Promise<DiscordConfig | null> => {
	const [project] = await db.select().from(s.project).where(eq(s.project.id, projectId)).execute();
	return project ? toDiscordConfig(project.id, project.discordSettings) : null;
};

export const upsertProjectDiscordConfig = async (data: {
	projectId: string;
	botToken: string;
	applicationId: string;
	publicKey: string;
	modelProvider?: LlmProvider;
	modelId?: string;
	mentionRoleIds?: string[];
	respondToChannelIds?: string[];
	fallbackUserId?: string;
	fallbackUserEmail?: string;
	hideAnswerLink?: boolean;
}): Promise<DiscordConfig> => {
	const updated = await takeFirstOrThrow(
		db
			.update(s.project)
			.set({
				discordSettings: {
					discordBotToken: data.botToken,
					discordApplicationId: data.applicationId,
					discordPublicKey: data.publicKey,
					discordLlmProvider: data.modelProvider ?? '',
					discordLlmModelId: data.modelId ?? '',
					discordMentionRoleIds: data.mentionRoleIds,
					discordRespondToChannelIds: data.respondToChannelIds,
					discordFallbackUserId: data.fallbackUserId,
					discordFallbackUserEmail: data.fallbackUserEmail,
					discordHideAnswerLink: data.hideAnswerLink,
				},
			})
			.where(eq(s.project.id, data.projectId))
			.returning()
			.execute(),
		`Project not found: ${data.projectId}`,
	);

	const config = toDiscordConfig(updated.id, updated.discordSettings);
	if (!config) {
		throw new Error(`Discord configuration not found after update: ${data.projectId}`);
	}
	return config;
};

export const updateProjectDiscordModel = async (
	projectId: string,
	modelProvider: LlmProvider | null,
	modelId: string | null,
): Promise<void> =>
	db.transaction((tx) => {
		const applyModel = (existing: DiscordSettings | null | undefined): DiscordSettings => ({
			discordBotToken: existing?.discordBotToken ?? '',
			discordApplicationId: existing?.discordApplicationId ?? '',
			discordPublicKey: existing?.discordPublicKey ?? '',
			discordLlmProvider: modelProvider ?? '',
			discordLlmModelId: modelId ?? '',
			discordMentionRoleIds: existing?.discordMentionRoleIds,
			discordRespondToChannelIds: existing?.discordRespondToChannelIds,
			discordFallbackUserId: existing?.discordFallbackUserId,
			discordFallbackUserEmail: existing?.discordFallbackUserEmail,
			discordHideAnswerLink: existing?.discordHideAnswerLink,
		});

		// SQLite drivers are synchronous: better-sqlite3 rejects a Promise-returning transaction
		// callback, and Bun's driver commits before an async body's awaited writes run. So use the
		// sync query API there and the async form only for Postgres, like createProjectWithDefaultGroup.
		if (dbConfig.dialect === Dialect.Postgres) {
			return (async () => {
				const project = await takeFirstOrThrow(
					lockForUpdate(tx.select().from(s.project).where(eq(s.project.id, projectId))).execute(),
					`Project not found: ${projectId}`,
				);
				await tx
					.update(s.project)
					.set({ discordSettings: applyModel(project.discordSettings) })
					.where(eq(s.project.id, projectId))
					.execute();
			})();
		}

		const project = tx.select().from(s.project).where(eq(s.project.id, projectId)).get();
		if (!project) {
			throw new Error(`Project not found: ${projectId}`);
		}
		tx.update(s.project)
			.set({ discordSettings: applyModel(project.discordSettings) })
			.where(eq(s.project.id, projectId))
			.run();
	});

export const deleteProjectDiscordConfig = async (projectId: string): Promise<void> => {
	await db.update(s.project).set({ discordSettings: null }).where(eq(s.project.id, projectId)).execute();
};

export const listProjectsWithDiscordEnabled = async (): Promise<DiscordConfig[]> => {
	const projects = await db.select().from(s.project).execute();
	return projects
		.map((project) => toDiscordConfig(project.id, project.discordSettings))
		.filter((config): config is DiscordConfig => config !== null);
};

function toDiscordConfig(projectId: string, settings: DiscordSettings | null | undefined): DiscordConfig | null {
	if (!settings?.discordBotToken || !settings.discordApplicationId) {
		return null;
	}

	return {
		projectId,
		botToken: settings.discordBotToken,
		applicationId: settings.discordApplicationId,
		publicKey: settings.discordPublicKey ?? '',
		redirectUrl: env.BETTER_AUTH_URL || 'http://localhost:3000/',
		modelSelection: toLlmSelectedModel(settings.discordLlmProvider, settings.discordLlmModelId),
		mentionRoleIds: settings.discordMentionRoleIds,
		respondToChannelIds: settings.discordRespondToChannelIds,
		fallbackUserId: settings.discordFallbackUserId,
		fallbackUserEmail: settings.discordFallbackUserEmail,
		hideAnswerLink: settings.discordHideAnswerLink,
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

export interface DiscordConfig {
	projectId: string;
	botToken: string;
	applicationId: string;
	publicKey: string;
	redirectUrl: string;
	modelSelection?: LlmSelectedModel;
	mentionRoleIds?: string[];
	respondToChannelIds?: string[];
	fallbackUserId?: string;
	fallbackUserEmail?: string;
	hideAnswerLink?: boolean;
}
