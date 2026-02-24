import { createOpenAI } from '@ai-sdk/openai';
import type { TranscriptionModel } from 'ai';

import type { ProviderSettings } from './providers';

export type TranscribeProvider = 'openai';

export type TranscribeModelDef = {
	id: string;
	name: string;
	default?: boolean;
	pricePerMinute?: number;
};

export type TranscribeProviderConfig = {
	envVar: string;
	models: readonly TranscribeModelDef[];
};

export const TRANSCRIBE_PROVIDERS: Record<TranscribeProvider, TranscribeProviderConfig> = {
	openai: {
		envVar: 'OPENAI_API_KEY',
		models: [
			{ id: 'gpt-4o-mini-transcribe', name: 'GPT-4o Mini Transcribe', default: true, pricePerMinute: 0.003 },
			{ id: 'gpt-4o-transcribe', name: 'GPT-4o Transcribe', pricePerMinute: 0.006 },
			{ id: 'whisper-1', name: 'Whisper', pricePerMinute: 0.006 },
		],
	},
};

export const KNOWN_TRANSCRIBE_MODELS = Object.fromEntries(
	Object.entries(TRANSCRIBE_PROVIDERS).map(([provider, config]) => [provider, config.models]),
) as Record<TranscribeProvider, readonly TranscribeModelDef[]>;

export function getDefaultTranscribeModelId(provider: TranscribeProvider): string {
	const models = TRANSCRIBE_PROVIDERS[provider].models;
	const defaultModel = models.find((m) => m.default);
	return defaultModel?.id ?? models[0].id;
}

type TranscribeModelCreator = (settings: ProviderSettings, modelId: string) => TranscriptionModel;

const TRANSCRIBE_MODEL_CREATORS: Record<TranscribeProvider, TranscribeModelCreator> = {
	openai: (settings, modelId) => createOpenAI(settings).transcription(modelId),
};

export function createTranscribeModel(
	provider: TranscribeProvider,
	settings: ProviderSettings,
	modelId: string,
): TranscriptionModel {
	return TRANSCRIBE_MODEL_CREATORS[provider](settings, modelId);
}
