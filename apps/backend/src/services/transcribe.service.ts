import { experimental_transcribe as transcribe } from 'ai';

import {
	createTranscribeModel,
	getDefaultTranscribeModelId,
	TRANSCRIBE_PROVIDERS,
	type TranscribeProvider,
} from '../agents/transcribe.providers';
import * as projectQueries from '../queries/project.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { getEnvApiKey } from '../utils/llm';

export async function transcribeAudio(
	projectId: string,
	audio: string,
	overrides?: { provider?: TranscribeProvider; modelId?: string },
): Promise<string> {
	const agentSettings = await projectQueries.getAgentSettings(projectId);
	const savedProvider = agentSettings?.transcribe?.provider as TranscribeProvider | undefined;
	const savedModelId = agentSettings?.transcribe?.modelId;

	const provider: TranscribeProvider = overrides?.provider ?? savedProvider ?? 'openai';
	const modelId = overrides?.modelId ?? savedModelId ?? getDefaultTranscribeModelId(provider);

	const { apiKey, baseURL } = await resolveProviderSettings(projectId, provider);
	if (!apiKey) {
		throw new Error(`No API key configured for ${provider}. Add one in Settings > Models.`);
	}

	const model = createTranscribeModel(provider, { apiKey, baseURL }, modelId);
	const audioBuffer = Buffer.from(audio, 'base64');

	const result = await transcribe({ model, audio: audioBuffer });
	return result.text;
}

export async function getAvailableModels(projectId: string) {
	const available: Record<
		string,
		{
			models: Array<{ id: string; name: string; default?: boolean; pricePerMinute?: number }>;
			hasKey: boolean;
		}
	> = {};

	for (const [provider, config] of Object.entries(TRANSCRIBE_PROVIDERS)) {
		const llmProvider = provider as 'openai';
		const dbConfig = await llmConfigQueries.getProjectLlmConfigByProvider(projectId, llmProvider);
		const envKey = getEnvApiKey(llmProvider);
		const hasKey = !!(dbConfig?.apiKey || envKey);

		available[provider] = {
			models: config.models.map((m) => ({
				id: m.id,
				name: m.name,
				...(m.default && { default: m.default }),
				...(m.pricePerMinute != null && { pricePerMinute: m.pricePerMinute }),
			})),
			hasKey,
		};
	}

	return available;
}

async function resolveProviderSettings(
	projectId: string,
	provider: TranscribeProvider,
): Promise<{ apiKey: string | undefined; baseURL: string | undefined }> {
	const llmProvider = provider as 'openai';
	const config = await llmConfigQueries.getProjectLlmConfigByProvider(projectId, llmProvider);

	if (config) {
		return { apiKey: config.apiKey, baseURL: config.baseUrl ?? undefined };
	}

	return { apiKey: getEnvApiKey(llmProvider), baseURL: undefined };
}
