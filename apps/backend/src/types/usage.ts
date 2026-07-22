import { z } from 'zod/v4';

import { MESSAGE_SOURCES } from './chat';
import { llmProviderSchema } from './llm';

export const granularitySchema = z.enum(['hour', 'day', 'month']);
export type Granularity = z.infer<typeof granularitySchema>;

export const USAGE_SOURCES = MESSAGE_SOURCES;
export type UsageSource = (typeof USAGE_SOURCES)[number];

export const usageFilterSchema = z.object({
	granularity: granularitySchema.default('day'),
	provider: llmProviderSchema.optional(),
	userNames: z.array(z.string()).optional(),
	sources: z.array(z.enum(USAGE_SOURCES)).optional(),
});
export type UsageFilter = z.infer<typeof usageFilterSchema>;

export interface UsageRecord {
	date: string;
	messageCount: number;
	webMessageCount: number;
	slackMessageCount: number;
	teamsMessageCount: number;
	telegramMessageCount: number;
	whatsappMessageCount: number;
	adminMessageCount: number;
	mcpMessageCount: number;
	contextRecommendationsMessageCount: number;
	inputNoCacheTokens: number;
	inputCacheReadTokens: number;
	inputCacheWriteTokens: number;
	outputTotalTokens: number;
	totalTokens: number;
	// Cost in USD (calculated from token usage and model pricing)
	inputNoCacheCost: number;
	inputCacheReadCost: number;
	inputCacheWriteCost: number;
	outputCost: number;
	totalCost: number;
}

export interface TotalUsageRecord {
	totalMessages: number;
	uniqueUsers: number;
}
