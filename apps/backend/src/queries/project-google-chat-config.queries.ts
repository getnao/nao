import type { LlmProvider, LlmSelectedModel } from '@nao/shared/types';
import { eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import { env } from '../env';
import { llmProviderSchema } from '../types/llm';
import type { GoogleChatSettings } from '../types/messaging-provider';
import { takeFirstOrThrow } from '../utils/queries';
import { updateProjectSettings } from './project-settings.queries';

export interface GoogleChatServiceAccountCredentials {
	client_email: string;
	private_key: string;
	project_id?: string;
}

export interface GoogleChatConfig {
	projectId: string;
	credentials: GoogleChatServiceAccountCredentials;
	googleCloudProjectNumber?: string;
	redirectUrl: string;
	modelSelection?: LlmSelectedModel;
}

export const getProjectGoogleChatConfig = async (projectId: string): Promise<GoogleChatConfig | null> => {
	const [project] = await db.select().from(s.project).where(eq(s.project.id, projectId)).execute();
	const settings = project?.googleChatSettings;
	const credentials = parseGoogleChatServiceAccountKey(settings?.googleChatServiceAccountKey);

	if (!settings || !credentials) {
		return null;
	}

	return {
		projectId,
		credentials,
		googleCloudProjectNumber: settings.googleChatProjectNumber || undefined,
		redirectUrl: env.BETTER_AUTH_URL || 'http://localhost:3000/',
		modelSelection: toLlmSelectedModel(settings.googleChatLlmProvider, settings.googleChatLlmModelId),
	};
};

export const upsertProjectGoogleChatConfig = async (data: {
	projectId: string;
	serviceAccountKey: string;
	googleCloudProjectNumber?: string;
	modelProvider?: LlmProvider;
	modelId?: string;
}): Promise<GoogleChatConfig> => {
	await takeFirstOrThrow(
		db
			.update(s.project)
			.set({
				googleChatSettings: {
					googleChatServiceAccountKey: data.serviceAccountKey,
					googleChatProjectNumber: data.googleCloudProjectNumber ?? '',
					googleChatLlmProvider: data.modelProvider ?? '',
					googleChatLlmModelId: data.modelId ?? '',
				},
			})
			.where(eq(s.project.id, data.projectId))
			.returning()
			.execute(),
		`Project not found: ${data.projectId}`,
	);

	const config = await getProjectGoogleChatConfig(data.projectId);
	if (!config) {
		throw new Error('Google Chat configuration could not be saved');
	}
	return config;
};

export const updateProjectGoogleChatModel = async (
	projectId: string,
	modelProvider: LlmProvider | null,
	modelId: string | null,
): Promise<void> => {
	await updateProjectSettings(
		projectId,
		'googleChatSettings',
		(existing): GoogleChatSettings => ({
			googleChatServiceAccountKey: existing?.googleChatServiceAccountKey ?? '',
			googleChatProjectNumber: existing?.googleChatProjectNumber ?? '',
			googleChatLlmProvider: modelProvider ?? '',
			googleChatLlmModelId: modelId ?? '',
		}),
	);
};

export const deleteProjectGoogleChatConfig = async (projectId: string): Promise<void> => {
	await db.update(s.project).set({ googleChatSettings: null }).where(eq(s.project.id, projectId)).execute();
};

/** Returns the service account credentials when the key is a JSON key file holding a client email and a private key. */
export function parseGoogleChatServiceAccountKey(
	serviceAccountKey: string | undefined,
): GoogleChatServiceAccountCredentials | null {
	if (!serviceAccountKey) {
		return null;
	}
	try {
		const parsed = JSON.parse(serviceAccountKey) as Partial<GoogleChatServiceAccountCredentials>;
		if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
			return null;
		}
		return { client_email: parsed.client_email, private_key: parsed.private_key, project_id: parsed.project_id };
	} catch {
		return null;
	}
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
