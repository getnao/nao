import { z } from 'zod/v4';

import { MESSAGE_SOURCES } from './chat';
import { llmProviderSchema } from './llm';

export const granularitySchema = z.enum(['hour', 'day', 'month']);
export type Granularity = z.infer<typeof granularitySchema>;

export const MAX_USAGE_CHART_BUCKETS_PER_REQUEST = 1000;
export const USAGE_CHART_BUCKET_LIMIT_MESSAGE = `Choose a range and granularity that produce at most ${MAX_USAGE_CHART_BUCKETS_PER_REQUEST.toLocaleString()} chart buckets.`;

export const USAGE_PERIOD_UNITS = ['hour', 'day', 'month'] as const;
export const usagePeriodUnitSchema = z.enum(USAGE_PERIOD_UNITS);
export type UsagePeriodUnit = z.infer<typeof usagePeriodUnitSchema>;

export const usagePeriodRangeSchema = z.object({
	value: z.number().int().positive(),
	unit: usagePeriodUnitSchema,
});
export type UsagePeriodRange = z.infer<typeof usagePeriodRangeSchema>;

export const USAGE_PERIOD_PRESETS = {
	'24h': { value: 24, unit: 'hour' },
	'15d': { value: 15, unit: 'day' },
	'6m': { value: 6, unit: 'month' },
} as const satisfies Record<string, UsagePeriodRange>;
export type UsagePeriodPreset = keyof typeof USAGE_PERIOD_PRESETS;

export const USAGE_PERIOD_PRESET_NAMES = ['24h', '15d', '6m'] as const satisfies readonly UsagePeriodPreset[];
export const USAGE_PERIOD_MODES = [...USAGE_PERIOD_PRESET_NAMES, 'saved'] as const;
export const usagePeriodModeSchema = z.enum(USAGE_PERIOD_MODES);
export type UsagePeriodMode = z.infer<typeof usagePeriodModeSchema>;

const usagePeriodPresetPreferenceSchema = z.object({
	mode: z.enum(USAGE_PERIOD_PRESET_NAMES),
});

const usagePeriodEntryPreferenceSchema = z.object({
	mode: z.literal('saved'),
	entryId: z.string().min(1),
});

export const usagePeriodPreferenceSchema = z.union([
	usagePeriodPresetPreferenceSchema,
	usagePeriodEntryPreferenceSchema,
]);
export type UsagePeriodPreference = z.infer<typeof usagePeriodPreferenceSchema>;

export const DEFAULT_USAGE_PERIOD_PREFERENCE = {
	mode: '15d',
} satisfies UsagePeriodPreference;

const usagePeriodEntryInputObjectSchema = z.object({
	days: z.number().int().positive(),
	granularity: granularitySchema,
});

export const usagePeriodEntryInputSchema = usagePeriodEntryInputObjectSchema.superRefine(
	({ days, granularity }, context) => {
		addBucketLimitIssue({ value: days, unit: 'day' }, granularity, context);
	},
);
export type UsagePeriodEntryInput = z.infer<typeof usagePeriodEntryInputSchema>;

export const usagePeriodEntrySchema = usagePeriodEntryInputObjectSchema
	.extend({
		id: z.string().min(1),
	})
	.superRefine(({ days, granularity }, context) => {
		addBucketLimitIssue({ value: days, unit: 'day' }, granularity, context);
	});
export type UsagePeriodEntry = z.infer<typeof usagePeriodEntrySchema>;

export const MAX_USAGE_PERIOD_ENTRIES = 16;
export const USAGE_PERIOD_ENTRY_LIMIT_MESSAGE = `You can save up to ${MAX_USAGE_PERIOD_ENTRIES} usage period entries.`;
export const usagePeriodEntriesSchema = z
	.array(usagePeriodEntrySchema)
	.max(MAX_USAGE_PERIOD_ENTRIES, USAGE_PERIOD_ENTRY_LIMIT_MESSAGE);

export interface UserProjectPreferences {
	usagePeriod?: UsagePeriodPreference;
	usagePeriodEntries?: UsagePeriodEntry[];
}

export function resolveUsagePeriod(
	preference: UsagePeriodPreference,
	entries: UsagePeriodEntry[] = [],
): UsagePeriodRange {
	if (preference.mode === 'saved') {
		const entry = entries.find(({ id }) => id === preference.entryId);
		return entry ? { value: entry.days, unit: 'day' } : USAGE_PERIOD_PRESETS['15d'];
	}
	return USAGE_PERIOD_PRESETS[preference.mode];
}

export const MAX_USAGE_CHART_BUCKETS: Record<Granularity, number> = {
	hour: 24,
	day: 30,
	month: 24,
};

export function resolveUsageChartGranularity(period: UsagePeriodRange): Granularity {
	if (period.unit === 'hour' && period.value > MAX_USAGE_CHART_BUCKETS.hour) {
		return 'day';
	}
	if (period.unit === 'day' && period.value > MAX_USAGE_CHART_BUCKETS.day) {
		return 'month';
	}
	return period.unit;
}

export function resolveUsagePeriodGranularity(
	preference: UsagePeriodPreference,
	entries: UsagePeriodEntry[] = [],
): Granularity {
	if (preference.mode === 'saved') {
		return entries.find(({ id }) => id === preference.entryId)?.granularity ?? 'day';
	}
	return resolveUsageChartGranularity(resolveUsagePeriod(preference, entries));
}

export function getUsageChartBucketCount(period: UsagePeriodRange, granularity: Granularity, now = new Date()): number {
	if (period.unit === granularity) {
		return period.value;
	}

	const firstBucket = new Date(getUsagePeriodStartTimestamp(period, now));
	const lastBucket = new Date(now);
	moveToUsageBucket(firstBucket, granularity);
	moveToUsageBucket(lastBucket, granularity);
	if (!Number.isFinite(firstBucket.getTime()) || !Number.isFinite(lastBucket.getTime())) {
		return Number.POSITIVE_INFINITY;
	}

	switch (granularity) {
		case 'hour':
			return Math.floor((lastBucket.getTime() - firstBucket.getTime()) / (60 * 60 * 1000)) + 1;
		case 'day':
			return Math.floor((lastBucket.getTime() - firstBucket.getTime()) / (24 * 60 * 60 * 1000)) + 1;
		case 'month':
			return (
				(lastBucket.getUTCFullYear() - firstBucket.getUTCFullYear()) * 12 +
				lastBucket.getUTCMonth() -
				firstBucket.getUTCMonth() +
				1
			);
	}
}

export const USAGE_SOURCES = MESSAGE_SOURCES;
export type UsageSource = (typeof USAGE_SOURCES)[number];

const usageFilterObjectSchema = z.object({
	period: usagePeriodRangeSchema,
	granularity: granularitySchema.optional(),
	provider: llmProviderSchema.optional(),
	userNames: z.array(z.string()).optional(),
	sources: z.array(z.enum(USAGE_SOURCES)).optional(),
});
export const usageFilterSchema = usageFilterObjectSchema.superRefine(({ period }, context) => {
	addBucketLimitIssue(period, resolveUsageChartGranularity(period), context);
});
export const usageChartFilterSchema = usageFilterObjectSchema.superRefine(({ period, granularity }, context) => {
	addBucketLimitIssue(period, granularity ?? resolveUsageChartGranularity(period), context);
});
export type UsageFilter = z.infer<typeof usageFilterSchema>;

function addBucketLimitIssue(period: UsagePeriodRange, granularity: Granularity, context: z.RefinementCtx): void {
	if (getUsageChartBucketCount(period, granularity) <= MAX_USAGE_CHART_BUCKETS_PER_REQUEST) {
		return;
	}
	context.addIssue({
		code: 'custom',
		message: USAGE_CHART_BUCKET_LIMIT_MESSAGE,
		path: ['granularity'],
	});
}

function getUsagePeriodStartTimestamp(period: UsagePeriodRange, now: Date): number {
	if (period.unit === 'month') {
		const start = new Date(now);
		start.setUTCMonth(start.getUTCMonth() - period.value);
		return start.getTime();
	}
	const milliseconds = period.unit === 'hour' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
	return now.getTime() - period.value * milliseconds;
}

function moveToUsageBucket(date: Date, granularity: Granularity): void {
	if (granularity === 'hour') {
		date.setUTCMinutes(0, 0, 0);
		return;
	}
	if (granularity === 'day') {
		date.setUTCHours(0, 0, 0, 0);
		return;
	}
	date.setUTCDate(1);
	date.setUTCHours(0, 0, 0, 0);
}

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
