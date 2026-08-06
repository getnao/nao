import type { LlmProvider, LlmSelectedModel } from '@nao/shared/types';
import { generateText } from 'ai';

import { disableModelReasoning, getProviderMeta, type ProviderModelResult } from '../agents/providers';
import { llmTelemetry } from '../agents/telemetry';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { resolveAnnotationModelId, resolveDefaultModelSelection, resolveProviderModel } from '../utils/llm';
import { sanitizeTitle, TITLE_MAX_OUTPUT_TOKENS, titleFromPrompt } from '../utils/title';

const FALLBACK_TITLE = 'Untitled automation';

export async function inferAutomationTitle(
	projectId: string,
	prompt: string,
	modelSelection?: LlmSelectedModel,
): Promise<string> {
	const trimmedPrompt = prompt.trim();
	if (!trimmedPrompt) {
		return FALLBACK_TITLE;
	}

	const modelConfig = await resolveModelForProject(projectId, modelSelection);
	if (!modelConfig) {
		return fallbackTitleFromPrompt(trimmedPrompt);
	}

	try {
		const { text } = await generateText({
			...disableModelReasoning(modelConfig.provider, modelConfig.model),
			system: 'Generate a short, descriptive title (3-8 words) for an automation based on its instructions. Always generate a title, no matter the input. Only capitalize the first letter of the title and proper nouns. Answer with the title alone, without quotes or any other text.',
			messages: [{ role: 'user', content: trimmedPrompt }],
			maxOutputTokens: TITLE_MAX_OUTPUT_TOKENS,
			experimental_telemetry: llmTelemetry('nao-automation-title', { projectId }),
		});

		return sanitizeTitle(text) || fallbackTitleFromPrompt(trimmedPrompt);
	} catch {
		return fallbackTitleFromPrompt(trimmedPrompt);
	}
}

async function resolveModelForProject(
	projectId: string,
	modelSelection?: LlmSelectedModel,
): Promise<{ provider: LlmProvider; model: ProviderModelResult } | null> {
	const pinned = modelSelection ? null : await resolveDefaultModelSelection(projectId, 'title');
	const provider =
		modelSelection?.provider ?? pinned?.provider ?? (await llmConfigQueries.getProjectModelProvider(projectId));
	if (!provider) {
		return null;
	}

	const defaultModelId = getProviderMeta(provider).summaryModelId;
	const modelId = modelSelection
		? await resolveAnnotationModelId(projectId, modelSelection, defaultModelId)
		: (pinned?.modelId ?? defaultModelId);
	const model = await resolveProviderModel(projectId, provider, modelId, false);
	return model ? { provider, model } : null;
}

function fallbackTitleFromPrompt(prompt: string): string {
	return titleFromPrompt(prompt) || FALLBACK_TITLE;
}
