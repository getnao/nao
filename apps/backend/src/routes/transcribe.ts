import { experimental_transcribe as transcribe } from 'ai';
import { z } from 'zod/v4';

import {
	createTranscribeModel,
	getDefaultTranscribeModelId,
	TRANSCRIBE_PROVIDERS,
	type TranscribeProvider,
} from '../agents/transcribe.providers';
import type { App } from '../app';
import { authMiddleware } from '../middleware/auth';
import * as projectQueries from '../queries/project.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { getEnvApiKey } from '../utils/llm';

const transcribeProviderSchema = z.enum(['openai']);

const MAX_AUDIO_SIZE = 25 * 1024 * 1024; // 25 MB

export const transcribeRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);

	app.post(
		'/transcribe',
		{
			bodyLimit: MAX_AUDIO_SIZE,
			schema: {
				body: z.object({
					audio: z.string(),
					provider: transcribeProviderSchema.optional(),
					modelId: z.string().optional(),
				}),
			},
		},
		async (request, reply) => {
			const projectId = request.project?.id;
			if (!projectId) {
				return reply
					.status(400)
					.send({ error: 'No project configured. Set NAO_DEFAULT_PROJECT_PATH environment variable.' });
			}

			const agentSettings = await projectQueries.getAgentSettings(projectId);
			const savedProvider = agentSettings?.transcribe?.provider as TranscribeProvider | undefined;
			const savedModelId = agentSettings?.transcribe?.modelId;

			const provider: TranscribeProvider = request.body.provider ?? savedProvider ?? 'openai';
			const modelId = request.body.modelId ?? savedModelId ?? getDefaultTranscribeModelId(provider);

			const { apiKey, baseURL } = await resolveProviderSettings(projectId, provider);
			if (!apiKey) {
				return reply.status(400).send({
					error: `No API key configured for ${provider}. Add one in Settings > Models.`,
				});
			}

			const model = createTranscribeModel(provider, { apiKey, baseURL }, modelId);
			const audioBuffer = Buffer.from(request.body.audio, 'base64');

			const result = await transcribe({ model, audio: audioBuffer });

			return reply.send({ text: result.text });
		},
	);

	app.get('/transcribe/models', async (request, reply) => {
		const projectId = request.project?.id;
		if (!projectId) {
			return reply.send({ providers: {} });
		}

		const available: Record<string, { models: Array<{ id: string; name: string }>; hasKey: boolean }> = {};

		for (const [provider, config] of Object.entries(TRANSCRIBE_PROVIDERS)) {
			const llmProvider = provider as 'openai';
			const dbConfig = await llmConfigQueries.getProjectLlmConfigByProvider(projectId, llmProvider);
			const envKey = getEnvApiKey(llmProvider);
			const hasKey = !!(dbConfig?.apiKey || envKey);

			available[provider] = {
				models: config.models.map((m) => ({ id: m.id, name: m.name })),
				hasKey,
			};
		}

		return reply.send({ providers: available });
	});
};

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
