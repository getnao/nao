import { generateText, Output } from 'ai';
import { z } from 'zod';

import { LLM_PROVIDERS, type ProviderModelResult } from '../agents/providers';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { resolveProviderModel } from '../utils/llm';

const FALLBACK_TITLE = 'Untitled automation';

export async function inferAutomationTitle(projectId: string, prompt: string): Promise<string> {
	const trimmedPrompt = prompt.trim();
	if (!trimmedPrompt) {
		return FALLBACK_TITLE;
	}

	const modelConfig = await resolveModelForProject(projectId);
	if (!modelConfig) {
		return fallbackTitleFromPrompt(trimmedPrompt);
	}

	try {
		const { output } = await generateText({
			model: modelConfig.model,
			system: 'Generate a short, descriptive title (3-8 words) for an automation based on its instructions. Always generate a title, no matter the input. Only capitalize the first letter of the title and proper nouns.',
			messages: [{ role: 'user', content: trimmedPrompt }],
			output: Output.object({
				schema: z.object({
					title: z.string().describe('A short, descriptive automation title (3-8 words)'),
				}),
			}),
			maxOutputTokens: 60,
		});

		const inferred = output?.title?.trim();
		return inferred && inferred.length > 0 ? inferred.slice(0, 255) : fallbackTitleFromPrompt(trimmedPrompt);
	} catch {
		return fallbackTitleFromPrompt(trimmedPrompt);
	}
}

async function resolveModelForProject(projectId: string): Promise<ProviderModelResult | null> {
	const provider = await llmConfigQueries.getProjectModelProvider(projectId);
	if (!provider) {
		return null;
	}

	const summaryModelId = LLM_PROVIDERS[provider].summaryModelId;
	return resolveProviderModel(projectId, provider, summaryModelId);
}

function fallbackTitleFromPrompt(prompt: string): string {
	const firstLine = prompt.split(/\r?\n/, 1)[0]?.trim() ?? '';
	if (!firstLine) {
		return FALLBACK_TITLE;
	}
	const truncated = firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine;
	return truncated;
}
