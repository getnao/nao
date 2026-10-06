import { isLlmProvider, type LlmProvider, providerLabel, providerName } from '@nao/shared/types';
import { experimental_transcribe as transcribe } from 'ai';

import { getProviderMeta, PROVIDER_META } from '../agents/provider-meta';
import {
	createTranscribeModel,
	getDefaultTranscribeModelId,
	getTranscribeModels,
	supportsTranscription,
} from '../agents/transcribe.providers';
import * as projectQueries from '../queries/project.queries';
import type { ProviderSettings, TranscribeModelDef } from '../types/llm';
import { getProjectModelSources, isProviderDisabled, resolveProviderSettings } from '../utils/llm';

export async function transcribeAudio(
	projectId: string,
	audio: string,
	overrides?: { provider?: LlmProvider; modelId?: string },
): Promise<string> {
	const agentSettings = await projectQueries.getAgentSettings(projectId);
	const transcribeSettings = agentSettings?.transcribe;

	const candidate = overrides?.provider ?? transcribeSettings?.provider;
	const { provider, settings } = await resolveTranscribeProvider(projectId, candidate);
	const modelId =
		overrides?.modelId ??
		(provider === candidate ? transcribeSettings?.modelId : undefined) ??
		getDefaultTranscribeModelId(provider);
	if (!modelId) {
		throw new Error(`Select a transcription model for ${providerLabel(provider)} in Settings > Transcription.`);
	}
	if (!settings) {
		throw new Error(`No API key configured for ${providerLabel(provider)}. Add one in Settings > Models.`);
	}

	const model = createTranscribeModel(provider, settings, modelId);
	const audioBuffer = Buffer.from(audio, 'base64');

	const result = await transcribe({ model, audio: audioBuffer });
	return result.text;
}

/**
 * Provider used for transcription when the saved one is missing or cannot transcribe.
 * A usable saved/override provider always wins; otherwise the first source with
 * credentials — same order the settings dropdown lists them — so the backend picks
 * what the UI shows. 'openai' is the last resort for the sake of its error message.
 * Returns the settings already resolved during the scan so the caller does not
 * look them up a second time.
 */
async function resolveTranscribeProvider(
	projectId: string,
	candidate: string | undefined,
): Promise<{ provider: LlmProvider; settings: ProviderSettings | null }> {
	if (candidate && isLlmProvider(candidate) && supportsTranscription(candidate)) {
		if (isProviderDisabled(candidate)) {
			throw new Error(`${providerLabel(candidate)} is disabled via DISABLED_PROVIDERS.`);
		}
		const settings = await resolveUsableSettings(projectId, candidate);
		if (settings) {
			return { provider: candidate, settings };
		}
	}

	for (const [kind, meta] of Object.entries(PROVIDER_META)) {
		if (!meta.transcription || isProviderDisabled(kind as LlmProvider)) {
			continue;
		}
		const settings = await resolveUsableSettings(projectId, kind as LlmProvider);
		if (settings) {
			return { provider: kind as LlmProvider, settings };
		}
	}

	const sources = await getProjectModelSources(projectId);
	for (const { provider } of sources) {
		if (!providerName(provider) || !supportsTranscription(provider)) {
			continue;
		}
		const settings = await resolveUsableSettings(projectId, provider);
		if (settings) {
			return { provider, settings };
		}
	}

	return { provider: 'openai', settings: null };
}

/**
 * Settings are usable when a key exists, or when the provider does not require one
 * (a local OpenAI-compatible endpoint). An empty key on a required provider means a
 * saved config lost its credential, which should not count as configured.
 */
async function resolveUsableSettings(projectId: string, provider: LlmProvider): Promise<ProviderSettings | null> {
	const settings = await resolveProviderSettings(projectId, provider);
	if (!settings) {
		return null;
	}
	if (getProviderMeta(provider).auth.apiKey === 'required' && !settings.apiKey) {
		return null;
	}
	return settings;
}

/**
 * Transcription models of every configured provider whose kind speaks the audio API. Bare kinds
 * are always listed (so the settings hint can name them); named instances only appear when
 * configured, since they exist only through DB or nao_config.yaml declarations.
 */
export async function listAvailableTranscribeModels(projectId: string) {
	const available: Record<string, { models: readonly TranscribeModelDef[]; hasKey: boolean }> = {};

	for (const [kind, meta] of Object.entries(PROVIDER_META)) {
		if (!meta.transcription || isProviderDisabled(kind as LlmProvider)) {
			continue;
		}
		available[kind] = {
			models: meta.transcription.models,
			hasKey: (await resolveUsableSettings(projectId, kind as LlmProvider)) !== null,
		};
	}

	const sources = await getProjectModelSources(projectId);
	for (const { provider } of sources) {
		if (!providerName(provider) || !supportsTranscription(provider)) {
			continue;
		}
		available[provider] = {
			models: getTranscribeModels(provider),
			hasKey: (await resolveUsableSettings(projectId, provider)) !== null,
		};
	}

	return available;
}
