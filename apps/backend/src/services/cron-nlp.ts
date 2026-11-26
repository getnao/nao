import { generateText } from 'ai';
import { CronExpressionParser } from 'cron-parser';

import { disableModelReasoning, getProviderMeta } from '../agents/providers';
import { llmTelemetry } from '../agents/telemetry';
import { sanitizeCron } from '../utils/cron';
import { ManagedCreditsExhaustedError } from '../utils/error';
import { resolveUserBackgroundModel } from './background-model.service';

/** Reasoning models spend most of the budget thinking before writing the expression. */
const MAX_OUTPUT_TOKENS = 1024;

export async function naturalLanguageToCron(projectId: string, userId: string, text: string): Promise<string | null> {
	const modelConfig = await resolveUserBackgroundModel({
		projectId,
		userId,
		defaultCategory: 'other',
		preferredModelId: ({ provider }) => getProviderMeta(provider).extractorModelId,
		usageContext: { userId, projectId, category: 'cron' },
	});
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
	} catch (error) {
		if (error instanceof ManagedCreditsExhaustedError) {
			throw error;
		}
		return null;
	}
}
