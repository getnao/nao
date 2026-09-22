import type { LlmProvider } from '@nao/shared/types';
import { generateText } from 'ai';
import { CronExpressionParser } from 'cron-parser';

import { disableModelReasoning, getProviderMeta, type ProviderModelResult } from '../agents/providers';
import { llmTelemetry } from '../agents/telemetry';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { sanitizeCron } from '../utils/cron';
import { resolveDefaultModelSelection, resolveProviderModel } from '../utils/llm';

/** Reasoning models spend most of the budget thinking before writing the expression. */
const MAX_OUTPUT_TOKENS = 1024;

export async function naturalLanguageToCron(projectId: string, text: string): Promise<string | null> {
	const modelConfig = await resolveModelForProject(projectId);
	if (!modelConfig) {
		return null;
	}

	try {
		const { text: answer } = await generateText({
			...disableModelReasoning(modelConfig.provider, modelConfig.model),
			system: [
				"Convert the user's natural language schedule description into a standard 5-field cron expression (minute hour day-of-month month day-of-week).",
				'Examples:',
				'  "every 5 minutes" → "*/5 * * * *"',
				'  "every hour" → "0 * * * *"',
				'  "every day at 8am" → "0 8 * * *"',
				'  "every monday at 9am" → "0 9 * * 1"',
				'  "first of every month" → "0 0 1 * *"',
				'  "weekdays at 6pm" → "0 18 * * 1-5"',
				'  "every 15 minutes during business hours" → "*/15 9-17 * * 1-5"',
				'Only output the cron expression, nothing else.',
			].join('\n'),
			messages: [{ role: 'user', content: text }],
			maxOutputTokens: MAX_OUTPUT_TOKENS,
			experimental_telemetry: llmTelemetry('nao-cron-nlp', { projectId }),
		});

		const cron = sanitizeCron(answer);
		if (!cron) {
			return null;
		}

		CronExpressionParser.parse(cron);
		return cron;
	} catch {
		return null;
	}
}

async function resolveModelForProject(
	projectId: string,
): Promise<{ provider: LlmProvider; model: ProviderModelResult } | null> {
	const pinned = await resolveDefaultModelSelection(projectId, 'other');
	const provider = pinned?.provider ?? (await llmConfigQueries.getProjectModelProvider(projectId));
	if (!provider) {
		return null;
	}

	const modelId = pinned?.modelId ?? getProviderMeta(provider).extractorModelId;
	const model = await resolveProviderModel(projectId, provider, modelId, false);
	return model ? { provider, model } : null;
}
