import { describe, expect, it } from 'vitest';

import {
	getUsageChartBucketCount,
	MAX_USAGE_CHART_BUCKETS,
	MAX_USAGE_CHART_BUCKETS_PER_REQUEST,
	resolveUsageChartGranularity,
	resolveUsagePeriod,
	resolveUsagePeriodGranularity,
	USAGE_PERIOD_PRESETS,
	usageChartFilterSchema,
	usageFilterSchema,
	usagePeriodEntryInputSchema,
	usagePeriodPreferenceSchema,
} from '../src/types/usage';
import { generateDateSeries } from '../src/utils/date';

describe('usage chart granularity', () => {
	it('keeps natural granularity for presets and short custom ranges', () => {
		expect(resolveUsageChartGranularity(USAGE_PERIOD_PRESETS['24h'])).toBe('hour');
		expect(resolveUsageChartGranularity(USAGE_PERIOD_PRESETS['15d'])).toBe('day');
		expect(resolveUsageChartGranularity(USAGE_PERIOD_PRESETS['6m'])).toBe('month');
		expect(resolveUsageChartGranularity({ value: 24, unit: 'hour' })).toBe('hour');
		expect(resolveUsageChartGranularity({ value: 30, unit: 'day' })).toBe('day');
		expect(resolveUsageChartGranularity({ value: 24, unit: 'month' })).toBe('month');
	});

	it('coarsens ranges above their natural granularity cap', () => {
		expect(resolveUsageChartGranularity({ value: 25, unit: 'hour' })).toBe('day');
		expect(resolveUsageChartGranularity({ value: 31, unit: 'day' })).toBe('month');
		expect(resolveUsageChartGranularity({ value: 300, unit: 'day' })).toBe('month');
		expect(resolveUsageChartGranularity({ value: 365, unit: 'day' })).toBe('month');
		expect(resolveUsageChartGranularity({ value: 168, unit: 'hour' })).toBe('day');
	});

	it('keeps generated series within the resolved granularity cap', () => {
		const periods = [
			{ value: 365, unit: 'day' as const },
			{ value: 300, unit: 'day' as const },
			{ value: 168, unit: 'hour' as const },
			{ value: 24, unit: 'month' as const },
		];

		for (const period of periods) {
			const granularity = resolveUsageChartGranularity(period);
			expect(generateDateSeries(period).length).toBeLessThanOrEqual(MAX_USAGE_CHART_BUCKETS[granularity]);
		}
	});

	it('preserves exact bucket counts for natural granularities', () => {
		expect(generateDateSeries(USAGE_PERIOD_PRESETS['24h']).length).toBe(24);
		expect(generateDateSeries(USAGE_PERIOD_PRESETS['15d']).length).toBe(15);
		expect(generateDateSeries(USAGE_PERIOD_PRESETS['6m']).length).toBe(6);
		expect(generateDateSeries({ value: 30, unit: 'day' }).length).toBe(30);
		expect(generateDateSeries({ value: 24, unit: 'month' }).length).toBe(24);
	});

	it('uses a saved entry period and explicit granularity', () => {
		const entry = { id: 'year', days: 365, granularity: 'month' as const };
		const preference = { mode: 'saved' as const, entryId: entry.id };

		expect(resolveUsagePeriod(preference, [entry])).toEqual({ value: 365, unit: 'day' });
		expect(resolveUsagePeriodGranularity(preference, [entry])).toBe('month');
		expect(generateDateSeries({ value: 365, unit: 'day' }, 'month')).toHaveLength(13);
	});

	it('enforces the technical bucket limit without limiting days', () => {
		expect(
			usagePeriodEntryInputSchema.safeParse({
				days: MAX_USAGE_CHART_BUCKETS_PER_REQUEST,
				granularity: 'day',
			}).success,
		).toBe(true);
		expect(
			usagePeriodEntryInputSchema.safeParse({
				days: MAX_USAGE_CHART_BUCKETS_PER_REQUEST + 1,
				granularity: 'day',
			}).success,
		).toBe(false);
		expect(usagePeriodEntryInputSchema.safeParse({ days: 5000, granularity: 'month' }).success).toBe(true);
		expect(usagePeriodEntryInputSchema.safeParse({ days: 42, granularity: 'hour' }).success).toBe(false);
	});

	it('validates explicit chart requests against their actual bucket count', () => {
		expect(getUsageChartBucketCount({ value: 41, unit: 'day' }, 'hour')).toBe(985);
		expect(
			usageChartFilterSchema.safeParse({
				period: { value: 41, unit: 'day' },
				granularity: 'hour',
			}).success,
		).toBe(true);
		expect(
			usageChartFilterSchema.safeParse({
				period: { value: 42, unit: 'day' },
				granularity: 'hour',
			}).success,
		).toBe(false);
	});

	it('rejects removed custom preferences and oversized usage requests', () => {
		const period = { value: 1001, unit: 'month' as const };

		expect(
			usagePeriodPreferenceSchema.safeParse({
				mode: 'custom',
				customPeriod: period,
			}).success,
		).toBe(false);
		expect(usageFilterSchema.safeParse({ period }).success).toBe(false);
	});

	it('keeps coarsened date series ordered after linear-time generation', () => {
		const dates = generateDateSeries({ value: 30, unit: 'day' }, 'hour');

		expect(dates).toHaveLength(721);
		expect([...dates].sort()).toEqual(dates);
	});
});
