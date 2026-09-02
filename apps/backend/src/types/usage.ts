import { z } from 'zod/v4';

import { MESSAGE_SOURCES } from './chat';
import { llmProviderSchema } from './llm';

export const granularitySchema = z.enum(['hour', 'day', 'month']);
export type Granularity = z.infer<typeof granularitySchema>;

export const USAGE_PERIOD_UNITS = ['hour', 'day', 'month'] as const;
export const usagePeriodUnitSchema = z.enum(USAGE_PERIOD_UNITS);
export type UsagePeriodUnit = z.infer<typeof usagePeriodUnitSchema>;

export const USAGE_PERIOD_LIMITS: Record<UsagePeriodUnit, number> = {
	hour: 24,
	day: 30,
	month: 24,
};

export const usagePeriodRangeSchema = z.discriminatedUnion('unit', [
	z.object({ value: z.number().int().min(1).max(USAGE_PERIOD_LIMITS.hour), unit: z.literal('hour') }),
	z.object({ value: z.number().int().min(1).max(USAGE_PERIOD_LIMITS.day), unit: z.literal('day') }),
	z.object({ value: z.number().int().min(1).max(USAGE_PERIOD_LIMITS.month), unit: z.literal('month') }),
]);
export type UsagePeriodRange = z.infer<typeof usagePeriodRangeSchema>;

export const USAGE_PERIOD_PRESETS = {
	'24h': { value: 24, unit: 'hour' },
	'15d': { value: 15, unit: 'day' },
	'6m': { value: 6, unit: 'month' },
} as const satisfies Record<string, UsagePeriodRange>;
export type UsagePeriodPreset = keyof typeof USAGE_PERIOD_PRESETS;

export const USAGE_PERIOD_MODES = ['24h', '15d', '6m', 'custom'] as const;
export const usagePeriodModeSchema = z.enum(USAGE_PERIOD_MODES);
export type UsagePeriodMode = z.infer<typeof usagePeriodModeSchema>;

export const usagePeriodPreferenceSchema = z.object({
	mode: usagePeriodModeSchema,
	customPeriod: usagePeriodRangeSchema,
});
export type UsagePeriodPreference = z.infer<typeof usagePeriodPreferenceSchema>;

export const DEFAULT_USAGE_PERIOD_PREFERENCE: UsagePeriodPreference = {
	mode: '15d',
	customPeriod: { value: 30, unit: 'day' },
};

export interface UserProjectPreferences {
	usagePeriod?: UsagePeriodPreference;
}

export function resolveUsagePeriod(preference: UsagePeriodPreference): UsagePeriodRange {
	return preference.mode === 'custom' ? preference.customPeriod : USAGE_PERIOD_PRESETS[preference.mode];
}

export const MAX_USAGE_CHART_BUCKETS: Record<Granularity, number> = USAGE_PERIOD_LIMITS;

export function resolveUsageChartGranularity(period: UsagePeriodRange): Granularity {
	if (period.unit === 'hour' && period.value > MAX_USAGE_CHART_BUCKETS.hour) {
		return 'day';
	}
	if (period.unit === 'day' && period.value > MAX_USAGE_CHART_BUCKETS.day) {
		return 'month';
	}
	return period.unit;
}

export const USAGE_SOURCES = MESSAGE_SOURCES;
export type UsageSource = (typeof USAGE_SOURCES)[number];

export const usageFilterSchema = z.object({
	period: usagePeriodRangeSchema.default(USAGE_PERIOD_PRESETS['15d']),
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
	mattermostMessageCount: number;
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
