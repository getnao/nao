import { createOpenAI } from '@ai-sdk/openai';
import type { LlmProvider } from '@nao/shared/types';
import { providerKind, providerLabel } from '@nao/shared/types';
import type { TranscriptionModel } from 'ai';

import type { ProviderSettings, TranscribeModelDef } from '../types/llm';
import { getProviderMeta, OPENAI_COMPATIBLE_BASE_URLS, supportsTranscription } from './provider-meta';

export { supportsTranscription };

export function getTranscribeModels(provider: LlmProvider): readonly TranscribeModelDef[] {
	return getProviderMeta(provider).transcription?.models ?? [];
}

export function getDefaultTranscribeModelId(provider: LlmProvider): string {
	const models = getTranscribeModels(provider);
	return models.find((m) => m.default)?.id ?? models[0]?.id ?? '';
}

/**
 * Every transcription-capable provider speaks the OpenAI audio API, so a single creator
 * covers them all; only the base URL differs. `createOpenAI` rejects an empty key, so
 * endpoints that need no auth (a local Whisper server) get a placeholder.
 */
export function createTranscribeModel(
	provider: LlmProvider,
	settings: ProviderSettings,
	modelId: string,
): TranscriptionModel {
	const kind = providerKind(provider);
	const meta = getProviderMeta(provider);
	const baseURL = settings.baseURL ?? OPENAI_COMPATIBLE_BASE_URLS[kind] ?? meta.defaultBaseUrl;
	if (!baseURL && meta.requiresBaseUrl) {
		throw new Error(`${providerLabel(provider)} needs a base URL: set one on the provider before using it`);
	}
	return createOpenAI({ apiKey: settings.apiKey || 'nao', ...(baseURL && { baseURL }) }).transcription(modelId);
}
