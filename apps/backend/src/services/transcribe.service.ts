import { experimental_transcribe as transcribe } from 'ai';

import {
	createTranscribeModel,
	getDefaultTranscribeModelId,
	TRANSCRIBE_PROVIDERS,
	type TranscribeProvider,
} from '../agents/transcribe.providers';
import * as projectQueries from '../queries/project.queries';
import { resolveProviderSettings as resolveLlmProviderSettings } from '../utils/llm';
import { getAllowedLlmConfigIdsForUserModel } from './user-group-llm-access.service';

export async function transcribeAudio(
	projectId: string,
	userId: string,
	audio: string,
	overrides?: { provider?: TranscribeProvider; modelId?: string },
): Promise<string> {
	const agentSettings = await projectQueries.getAgentSettings(projectId);
	const savedProvider = agentSettings?.transcribe?.provider as TranscribeProvider | undefined;
	const savedModelId = agentSettings?.transcribe?.modelId;

	const provider: TranscribeProvider = overrides?.provider ?? savedProvider ?? 'openai';
	const preferredModelId = overrides?.modelId ?? savedModelId ?? getDefaultTranscribeModelId(provider);
	const candidateModelIds = overrides?.modelId
		? [preferredModelId]
		: [preferredModelId, ...TRANSCRIBE_PROVIDERS[provider].models.map((model) => model.id)];

	const runnable = await findRunnableTranscribeModel(projectId, userId, provider, candidateModelIds);
	if (!runnable) {
		throw new Error(`No API key configured for ${provider}. Add one in Settings > Models.`);
	}

	const model = createTranscribeModel(provider, runnable.settings, runnable.modelId);
	const audioBuffer = Buffer.from(audio, 'base64');

	const result = await transcribe({ model, audio: audioBuffer });
	return result.text;
}

export async function listAvailableTranscribeModels(projectId: string, userId: string) {
	const available: Record<
		string,
		{
			models: Array<{ id: string; name: string; default?: boolean; pricePerMinute?: number }>;
			hasKey: boolean;
		}
	> = {};

	for (const [provider, config] of Object.entries(TRANSCRIBE_PROVIDERS)) {
		const models = [];
		for (const model of config.models) {
			const settings = await resolveTranscribeProviderSettings(
				projectId,
				userId,
				provider as TranscribeProvider,
				model.id,
			);
			if (!settings.apiKey) {
				continue;
			}
			models.push({
				id: model.id,
				name: model.name,
				...(model.default && { default: model.default }),
				...(model.pricePerMinute != null && { pricePerMinute: model.pricePerMinute }),
			});
		}

		available[provider] = {
			models,
			hasKey: models.length > 0,
		};
	}

	return available;
}

async function findRunnableTranscribeModel(
	projectId: string,
	userId: string,
	provider: TranscribeProvider,
	modelIds: string[],
): Promise<{ modelId: string; settings: { apiKey: string; baseURL: string | undefined } } | null> {
	for (const modelId of new Set(modelIds)) {
		const { apiKey, baseURL } = await resolveTranscribeProviderSettings(projectId, userId, provider, modelId);
		if (apiKey) {
			return { modelId, settings: { apiKey, baseURL } };
		}
	}
	return null;
}

async function resolveTranscribeProviderSettings(
	projectId: string,
	userId: string,
	provider: TranscribeProvider,
	modelId: string,
): Promise<{ apiKey: string | undefined; baseURL: string | undefined }> {
	const llmProvider = provider as 'openai';
	const allowedConfigIds = await getAllowedLlmConfigIdsForUserModel(projectId, userId, modelId);
	if (allowedConfigIds === null) {
		const settings = await resolveLlmProviderSettings(projectId, llmProvider);
		return { apiKey: settings?.apiKey, baseURL: settings?.baseURL };
	}
	for (const configId of allowedConfigIds) {
		const settings = await resolveLlmProviderSettings(projectId, llmProvider, configId);
		if (settings) {
			return { apiKey: settings.apiKey, baseURL: settings.baseURL };
		}
	}
	return { apiKey: undefined, baseURL: undefined };
}
