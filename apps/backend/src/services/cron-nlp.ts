import { generateText, Output } from 'ai';
import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod';

import { LLM_PROVIDERS, type ProviderModelResult } from '../agents/providers';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { resolveProviderModel } from '../utils/llm';

export async function naturalLanguageToCron(projectId: string, text: string): Promise<string | null> {
	const modelConfig = await resolveModelForProject(projectId);
	if (!modelConfig) {
		return null;
	}

	try {
		const { output } = await generateText({
			model: modelConfig.model,
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
			output: Output.object({
				schema: z.object({
					cron: z.string().describe('The 5-field cron expression'),
				}),
			}),
			maxOutputTokens: 60,
		});

		const cron = output?.cron?.trim();
		if (!cron) {
			return null;
		}

		CronExpressionParser.parse(cron);
		return cron;
	} catch {
		return null;
	}
}

async function resolveModelForProject(projectId: string): Promise<ProviderModelResult | null> {
	const provider = await llmConfigQueries.getProjectModelProvider(projectId);
	if (!provider) {
		return null;
	}

	const extractorModelId = LLM_PROVIDERS[provider].extractorModelId;
	return resolveProviderModel(projectId, provider, extractorModelId);
}
