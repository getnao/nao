import { eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
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

export const getProjectTeamsConfig = async (
	projectId: string,
): Promise<{
	appId: string;
	appPassword: string;
	tenantId: string;
	modelSelection?: ModelSelection;
} | null> => {
	const [project] = await db.select().from(s.project).where(eq(s.project.id, projectId)).execute();
	const settings = project?.teamsSettings;

	if (!settings?.teamsAppId || !settings?.teamsAppPassword || !settings?.teamsTenantId) {
		return null;
	}

	return {
		appId: settings.teamsAppId,
		appPassword: settings.teamsAppPassword,
		tenantId: settings.teamsTenantId,
		modelSelection: toModelSelection(settings.teamsLlmProvider, settings.teamsLlmModelId),
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
	modelSelection?: ModelSelection;
}> => {
	const [updated] = await db
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
		.execute();

	if (!updated) {
		throw new Error(`Project not found: ${data.projectId}`);
	}

	const settings = updated.teamsSettings;
	return {
		appId: settings?.teamsAppId || '',
		appPassword: settings?.teamsAppPassword || '',
		tenantId: settings?.teamsTenantId || '',
		modelSelection: toModelSelection(settings?.teamsLlmProvider, settings?.teamsLlmModelId),
	};
};

export const updateProjectTeamsModel = async (
	projectId: string,
	modelProvider: LlmProvider | null,
	modelId: string | null,
): Promise<void> => {
	await db.transaction(async (tx) => {
		const [project] = await tx.select().from(s.project).where(eq(s.project.id, projectId)).execute();
		const existing = project?.teamsSettings;

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
	tenantId?: string;
	redirectUrl: string;
	modelSelection?: ModelSelection;
}

/**
 * Get Teams configuration from project config with env var fallbacks.
 * This is the single source of truth for all Teams config values.
 */
export async function getTeamsConfig(): Promise<TeamsConfig | null> {
	const projectPath = env.NAO_DEFAULT_PROJECT_PATH;
	if (!projectPath) {
		return null;
	}

	const [project] = await db.select().from(s.project).where(eq(s.project.path, projectPath)).execute();

	if (!project) {
		return null;
	}

	const settings = project.teamsSettings;
	const appId = settings?.teamsAppId;
	const appPassword = settings?.teamsAppPassword;
	const tenantId = settings?.teamsTenantId;
	const redirectUrl = env.BETTER_AUTH_URL || 'http://localhost:3000/';

	if (!appId || !appPassword || !tenantId) {
		return null;
	}

	return {
		projectId: project.id,
		appId,
		appPassword,
		tenantId,
		redirectUrl,
		modelSelection: toModelSelection(settings?.teamsLlmProvider, settings?.teamsLlmModelId),
	};
}
