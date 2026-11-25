import type { LlmSelectedModel } from '@nao/shared/types';
import { generateText } from 'ai';

import { disableModelReasoning, getProviderMeta } from '../agents/providers';
import { llmTelemetry } from '../agents/telemetry';
import { resolveAnnotationModelId } from '../utils/llm';
import { sanitizeTitle, TITLE_MAX_OUTPUT_TOKENS, titleFromPrompt, titleGenerationUserMessage } from '../utils/title';
import { type BackgroundModel, resolveUserBackgroundModel } from './background-model.service';

const FALLBACK_TITLE = 'Untitled automation';

export async function inferAutomationTitle(
	projectId: string,
	userId: string,
	prompt: string,
	modelSelection?: LlmSelectedModel,
): Promise<string> {
	const trimmedPrompt = prompt.trim();
	if (!trimmedPrompt) {
		return FALLBACK_TITLE;
	}

	const modelConfig = await resolveTitleModel(projectId, userId, modelSelection);
	if (!modelConfig) {
		return fallbackTitleFromPrompt(trimmedPrompt);
	}

	try {
		const { text } = await generateText({
			...disableModelReasoning(modelConfig.provider, modelConfig.model),
			system: 'Generate a short, descriptive title (3-8 words) for an automation based on its instructions. Always generate a title, no matter the input. Only capitalize the first letter of the title and proper nouns. Answer with the title alone, without quotes or any other text.',
			messages: [{ role: 'user', content: titleGenerationUserMessage(trimmedPrompt) }],
			maxOutputTokens: TITLE_MAX_OUTPUT_TOKENS,
			experimental_telemetry: llmTelemetry('nao-automation-title', { projectId }),
		});

		return sanitizeTitle(text) || fallbackTitleFromPrompt(trimmedPrompt);
	} catch {
		return fallbackTitleFromPrompt(trimmedPrompt);
	}
}

function resolveTitleModel(
	projectId: string,
	userId: string,
	modelSelection?: LlmSelectedModel,
): Promise<BackgroundModel | null> {
	return resolveUserBackgroundModel({
		projectId,
		userId,
		defaultCategory: modelSelection ? undefined : 'title',
		fallback: modelSelection,
		preferredModelId: (selection) => {
			const summaryModelId = getProviderMeta(selection.provider).summaryModelId;
			return modelSelection ? resolveAnnotationModelId(projectId, selection, summaryModelId) : summaryModelId;
		},
		usageContext: { userId, projectId, category: 'automation' },
	});
}

function fallbackTitleFromPrompt(prompt: string): string {
	return titleFromPrompt(prompt) || FALLBACK_TITLE;
}
