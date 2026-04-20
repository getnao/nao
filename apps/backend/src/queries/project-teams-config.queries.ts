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

export const getProjectTeamsConfig = async (projectId: string): Promise<TeamsConfig | null> => {
	const [project] = await db.select().from(s.project).where(eq(s.project.id, projectId)).execute();
	const settings = project?.teamsSettings;

	if (!settings?.teamsAppId || !settings?.teamsAppPassword || !settings?.teamsTenantId) {
		return null;
	}

	return {
		projectId,
		appId: settings.teamsAppId,
		appPassword: settings.teamsAppPassword,
		tenantId: settings.teamsTenantId,
		redirectUrl: env.BETTER_AUTH_URL || 'http://localhost:3000/',
		modelSelection: toLlmSelectedModel(settings.teamsLlmProvider, settings.teamsLlmModelId),
	};
};

export const upsertProjectTeamsConfig = async (data: {
	projectId: string;
	appId: string;
	appPassword: string;
	tenantId: string;
	modelProvider?: LlmProvider;
	modelId?: string;
}): Promise<{
	appId: string;
	appPassword: string;
	tenantId: string;
	modelSelection?: LlmSelectedModel;
}> => {
	const updated = await takeFirstOrThrow(
		db
			.update(s.project)
			.set({
				teamsSettings: {
					teamsAppId: data.appId,
					teamsAppPassword: data.appPassword,
					teamsTenantId: data.tenantId,
					teamsLlmProvider: data.modelProvider ?? '',
					teamsLlmModelId: data.modelId ?? '',
				},
			})
			.where(eq(s.project.id, data.projectId))
			.returning()
			.execute(),
		`Project not found: ${data.projectId}`,
	);

	const settings = updated.teamsSettings;
	return {
		appId: settings?.teamsAppId || '',
		appPassword: settings?.teamsAppPassword || '',
		tenantId: settings?.teamsTenantId || '',
		modelSelection: toLlmSelectedModel(settings?.teamsLlmProvider, settings?.teamsLlmModelId),
	};
};

export const updateProjectTeamsModel = async (
	projectId: string,
	modelProvider: LlmProvider | null,
	modelId: string | null,
): Promise<void> => {
	await db.transaction(async (tx) => {
		const project = await takeFirstOrThrow(
			tx.select().from(s.project).where(eq(s.project.id, projectId)).execute(),
			`Project not found: ${projectId}`,
		);
		const existing = project.teamsSettings;

		await tx
			.update(s.project)
			.set({
				teamsSettings: {
					teamsAppId: existing?.teamsAppId ?? '',
					teamsAppPassword: existing?.teamsAppPassword ?? '',
					teamsTenantId: existing?.teamsTenantId ?? '',
					teamsLlmProvider: modelProvider ?? '',
					teamsLlmModelId: modelId ?? '',
				},
			})
			.where(eq(s.project.id, projectId))
			.execute();
	});
};

export const deleteProjectTeamsConfig = async (projectId: string): Promise<void> => {
	await db.update(s.project).set({ teamsSettings: null }).where(eq(s.project.id, projectId)).execute();
};

export interface TeamsConfig {
	projectId: string;
	appId: string;
	appPassword: string;
	tenantId: string;
	redirectUrl: string;
	modelSelection?: LlmSelectedModel;
}
