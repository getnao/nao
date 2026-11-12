import { experimental_transcribe as transcribe } from 'ai';

import {
	createTranscribeModel,
	getDefaultTranscribeModelId,
	TRANSCRIBE_PROVIDERS,
	type TranscribeProvider,
} from '../agents/transcribe.providers';
import * as projectQueries from '../queries/project.queries';
import { resolveProviderSettings as resolveLlmProviderSettings } from '../utils/llm';
import { getAllowedLlmConfigIdsForUserModel, getAvailableModelsForUser } from './user-group-llm-access.service';

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
	const modelId = overrides?.modelId ?? savedModelId ?? getDefaultTranscribeModelId(provider);

	const { apiKey, baseURL } = await resolveTranscribeProviderSettings(projectId, userId, provider, modelId);
	if (!apiKey) {
		throw new Error(`No API key configured for ${provider}. Add one in Settings > Models.`);
	}

	const model = createTranscribeModel(provider, { apiKey, baseURL }, modelId);
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
		const llmProvider = provider as 'openai';
		const availableModel = (await getAvailableModelsForUser(projectId, userId)).find(
			(model) => model.provider === llmProvider,
		);
		const settings = availableModel
			? await resolveLlmProviderSettings(projectId, llmProvider, availableModel.llmConfigId)
			: null;

		available[provider] = {
			models: config.models.map((m) => ({
				id: m.id,
				name: m.name,
				...(m.default && { default: m.default }),
				...(m.pricePerMinute != null && { pricePerMinute: m.pricePerMinute }),
			})),
			hasKey: Boolean(settings?.apiKey),
		};
	}

	return available;
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
