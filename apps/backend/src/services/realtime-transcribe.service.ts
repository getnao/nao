import { getDefaultTranscribeModelId, type TranscribeProvider } from '../agents/transcribe.providers';
import * as projectQueries from '../queries/project.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { getEnvApiKey } from '../utils/llm';

export type LiveTranscriptionSession = {
	clientSecret: string;
	expiresAt: number;
};

type OpenAITranscriptionSessionResponse = {
	client_secret?: { value?: string; expires_at?: number };
};

export async function createLiveTranscriptionSession(projectId: string): Promise<LiveTranscriptionSession> {
	const agentSettings = await projectQueries.getAgentSettings(projectId);
	if (!agentSettings?.transcribe?.enabled) {
		throw new Error('Voice input is not enabled. Enable transcription in Settings > Models.');
	}

	const modelId = agentSettings.transcribe.modelId ?? getDefaultTranscribeModelId('openai');
	const { apiKey, baseURL } = await resolveProviderSettings(projectId, 'openai');
	if (!apiKey) {
		throw new Error('No OpenAI API key configured. Add one in Settings > Models.');
	}

	const apiBase = (baseURL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
	const response = await fetch(`${apiBase}/realtime/transcription_sessions`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			input_audio_format: 'pcm16',
			input_audio_transcription: { model: modelId },
			turn_detection: {
				type: 'server_vad',
				threshold: 0.5,
				prefix_padding_ms: 300,
				silence_duration_ms: 700,
			},
		}),
	});

	if (!response.ok) {
		const detail = await response.text();
		throw new Error(detail || `Failed to create live transcription session (${response.status})`);
	}

	const data = (await response.json()) as OpenAITranscriptionSessionResponse;
	const clientSecret = data.client_secret?.value;
	const expiresAt = data.client_secret?.expires_at;
	if (!clientSecret || expiresAt == null) {
		throw new Error('Invalid live transcription session response from OpenAI');
	}

	return { clientSecret, expiresAt };
}

async function resolveProviderSettings(
	projectId: string,
	provider: TranscribeProvider,
): Promise<{ apiKey: string | undefined; baseURL: string | undefined }> {
	const config = await llmConfigQueries.getProjectLlmConfigByProvider(projectId, provider);
	if (config) {
		return { apiKey: config.apiKey, baseURL: config.baseUrl ?? undefined };
	}
	return { apiKey: getEnvApiKey(provider), baseURL: undefined };
}
