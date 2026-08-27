import { z } from 'zod/v4';

import { MESSAGE_SOURCES } from './chat';
import { llmProviderSchema } from './llm';

export const granularitySchema = z.enum(['hour', 'day', 'month']);
export type Granularity = z.infer<typeof granularitySchema>;

export const USAGE_PERIODS = ['24h', '7d', '15d', '30d', '60d', '90d', '6m'] as const;
export const usagePeriodSchema = z.enum(USAGE_PERIODS);
export type UsagePeriod = z.infer<typeof usagePeriodSchema>;

export const PERIOD_CONFIG: Record<UsagePeriod, { count: number; granularity: Granularity; label: string }> = {
	'24h': { count: 24, granularity: 'hour', label: 'Last 24 hours' },
	'7d': { count: 7, granularity: 'day', label: 'Last 7 days' },
	'15d': { count: 15, granularity: 'day', label: 'Last 15 days' },
	'30d': { count: 30, granularity: 'day', label: 'Last 30 days' },
	'60d': { count: 60, granularity: 'day', label: 'Last 60 days' },
	'90d': { count: 90, granularity: 'day', label: 'Last 90 days' },
	'6m': { count: 6, granularity: 'month', label: 'Last 6 months' },
};

export const DEFAULT_PERIOD_BY_GRANULARITY: Record<Granularity, UsagePeriod> = {
	hour: '24h',
	day: '15d',
	month: '6m',
};

export const USAGE_SOURCES = MESSAGE_SOURCES;
export type UsageSource = (typeof USAGE_SOURCES)[number];

export const usageFilterSchema = z.object({
	granularity: granularitySchema.optional(),
	period: usagePeriodSchema.optional(),
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
