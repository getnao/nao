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

export const getProjectWhatsappConfig = async (
	projectId: string,
): Promise<{
	accessToken: string;
	appSecret: string;
	phoneNumberId: string;
	verifyToken: string;
	modelSelection?: LlmSelectedModel;
} | null> => {
	const [project] = await db.select().from(s.project).where(eq(s.project.id, projectId)).execute();
	const settings = project?.whatsappSettings;

	if (
		!settings?.whatsappAccessToken ||
		!settings?.whatsappAppSecret ||
		!settings?.whatsappPhoneNumberId ||
		!settings?.whatsappVerifyToken
	) {
		return null;
	}

	return {
		accessToken: settings.whatsappAccessToken,
		appSecret: settings.whatsappAppSecret,
		phoneNumberId: settings.whatsappPhoneNumberId,
		verifyToken: settings.whatsappVerifyToken,
		modelSelection: toLlmSelectedModel(settings.whatsappLlmProvider, settings.whatsappLlmModelId),
	};
};

export const upsertProjectWhatsappConfig = async (data: {
	projectId: string;
	accessToken: string;
	appSecret: string;
	phoneNumberId: string;
	verifyToken: string;
	modelProvider?: LlmProvider;
	modelId?: string;
}): Promise<{
	accessToken: string;
	appSecret: string;
	phoneNumberId: string;
	verifyToken: string;
	modelSelection?: LlmSelectedModel;
}> => {
	const updated = await takeFirstOrThrow(
		db
			.update(s.project)
			.set({
				whatsappSettings: {
					whatsappAccessToken: data.accessToken,
					whatsappAppSecret: data.appSecret,
					whatsappPhoneNumberId: data.phoneNumberId,
					whatsappVerifyToken: data.verifyToken,
					whatsappLlmProvider: data.modelProvider ?? '',
					whatsappLlmModelId: data.modelId ?? '',
				},
			})
			.where(eq(s.project.id, data.projectId))
			.returning()
			.execute(),
		`Project not found: ${data.projectId}`,
	);

	const settings = updated.whatsappSettings;
	return {
		accessToken: settings?.whatsappAccessToken || '',
		appSecret: settings?.whatsappAppSecret || '',
		phoneNumberId: settings?.whatsappPhoneNumberId || '',
		verifyToken: settings?.whatsappVerifyToken || '',
		modelSelection: toLlmSelectedModel(settings?.whatsappLlmProvider, settings?.whatsappLlmModelId),
	};
};

export const updateProjectWhatsappModel = async (
	projectId: string,
	modelProvider: LlmProvider | null,
	modelId: string | null,
): Promise<void> => {
	await db.transaction(async (tx) => {
		const project = await takeFirstOrThrow(
			tx.select().from(s.project).where(eq(s.project.id, projectId)).execute(),
			`Project not found: ${projectId}`,
		);
		const existing = project.whatsappSettings;

		await tx
			.update(s.project)
			.set({
				whatsappSettings: {
					whatsappAccessToken: existing?.whatsappAccessToken ?? '',
					whatsappAppSecret: existing?.whatsappAppSecret ?? '',
					whatsappPhoneNumberId: existing?.whatsappPhoneNumberId ?? '',
					whatsappVerifyToken: existing?.whatsappVerifyToken ?? '',
					whatsappLlmProvider: modelProvider ?? '',
					whatsappLlmModelId: modelId ?? '',
				},
			})
			.where(eq(s.project.id, projectId))
			.execute();
	});
};

export const deleteProjectWhatsappConfig = async (projectId: string): Promise<void> => {
	await db.update(s.project).set({ whatsappSettings: null }).where(eq(s.project.id, projectId)).execute();
};

export interface WhatsappConfig {
	projectId: string;
	accessToken: string;
	appSecret: string;
	phoneNumberId: string;
	verifyToken: string;
	redirectUrl: string;
	modelSelection?: LlmSelectedModel;
}

/**
 * Get WhatsApp configuration from project config with env var fallbacks.
 * This is the single source of truth for all WhatsApp config values.
 */
export async function getWhatsappConfig(): Promise<WhatsappConfig | null> {
	const projectPath = env.NAO_DEFAULT_PROJECT_PATH;
	if (!projectPath) {
		return null;
	}

	const [project] = await db.select().from(s.project).where(eq(s.project.path, projectPath)).execute();

	if (!project) {
		return null;
	}

	const settings = project.whatsappSettings;
	const accessToken = settings?.whatsappAccessToken;
	const appSecret = settings?.whatsappAppSecret;
	const phoneNumberId = settings?.whatsappPhoneNumberId;
	const verifyToken = settings?.whatsappVerifyToken;
	const redirectUrl = env.BETTER_AUTH_URL || 'http://localhost:3000/';

	if (!accessToken || !appSecret || !phoneNumberId || !verifyToken) {
		return null;
	}

	return {
		projectId: project.id,
		accessToken,
		appSecret,
		phoneNumberId,
		verifyToken,
		redirectUrl,
		modelSelection: toLlmSelectedModel(settings?.whatsappLlmProvider, settings?.whatsappLlmModelId),
	};
}
