import { afterEach, describe, expect, it, vi } from 'vitest';

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
import { formatDate, generateDateSeries, getLookbackTimestamp } from '../src/utils/date';

describe('usage chart granularity', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('keeps natural granularity for presets and short custom ranges', () => {
		expect(resolveUsageChartGranularity(USAGE_PERIOD_PRESETS['24h'])).toBe('hour');
		expect(resolveUsageChartGranularity(USAGE_PERIOD_PRESETS['15d'])).toBe('day');
		expect(resolveUsageChartGranularity(USAGE_PERIOD_PRESETS['6m'])).toBe('month');
		expect(resolveUsageChartGranularity({ value: 24, unit: 'hour' })).toBe('hour');
		expect(resolveUsageChartGranularity({ value: 30, unit: 'day' })).toBe('day');
		expect(resolveUsageChartGranularity({ value: 24, unit: 'month' })).toBe('month');
	});

	it('coarsens ranges above their natural granularity cap', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-03T10:00:00Z'));

		expect(resolveUsageChartGranularity({ value: 25, unit: 'hour' })).toBe('day');
		expect(resolveUsageChartGranularity({ value: 31, unit: 'day' })).toBe('month');
		expect(resolveUsageChartGranularity({ value: 300, unit: 'day' })).toBe('month');
		expect(resolveUsageChartGranularity({ value: 365, unit: 'day' })).toBe('month');
		expect(resolveUsageChartGranularity({ value: 168, unit: 'hour' })).toBe('day');
		expect(resolveUsageChartGranularity({ value: 720, unit: 'hour' })).toBe('month');
	});

	it('keeps generated series within the resolved granularity cap', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-03T10:00:00Z'));
		const periods = [
			{ value: 365, unit: 'day' as const },
			{ value: 300, unit: 'day' as const },
			{ value: 168, unit: 'hour' as const },
			{ value: 720, unit: 'hour' as const },
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

	it('aligns the lookback with the first visible calendar bucket', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-31T12:30:00Z'));

		for (const period of Object.values(USAGE_PERIOD_PRESETS)) {
			const firstBucket = generateDateSeries(period)[0];
			const lookback = formatDate(new Date(getLookbackTimestamp(period)), period.unit);

			expect(lookback).toBe(firstBucket);
		}
		expect(new Date(getLookbackTimestamp(USAGE_PERIOD_PRESETS['6m'])).toISOString()).toBe(
			'2026-03-01T00:00:00.000Z',
		);
	});

	it('uses a saved entry period and explicit granularity', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-03T10:00:00Z'));
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
		expect(usagePeriodEntryInputSchema.safeParse({ days: 84, granularity: 'hour' }).success).toBe(false);
	});

	it('validates explicit chart requests against their actual bucket count', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-03T10:00:00Z'));

		expect(getUsageChartBucketCount({ value: 83, unit: 'day' }, 'hour')).toBe(1979);
		expect(
			usageChartFilterSchema.safeParse({
				period: { value: 83, unit: 'day' },
				granularity: 'hour',
			}).success,
		).toBe(true);
		expect(
			usageChartFilterSchema.safeParse({
				period: { value: 84, unit: 'day' },
				granularity: 'hour',
			}).success,
		).toBe(false);
	});

	it('counts the same coarsened buckets as the generated date series', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-31T12:30:00Z'));
		const cases = [
			[{ value: 83, unit: 'day' as const }, 'hour' as const],
			[{ value: 365, unit: 'day' as const }, 'month' as const],
			[{ value: 1, unit: 'month' as const }, 'day' as const],
		] as const;

		for (const [period, granularity] of cases) {
			expect(getUsageChartBucketCount(period, granularity)).toBe(generateDateSeries(period, granularity).length);
		}
	});

	it('requires callers to provide an explicit period', () => {
		expect(usageFilterSchema.safeParse({}).success).toBe(false);
		expect(usageChartFilterSchema.safeParse({ granularity: 'hour' }).success).toBe(false);
	});

	it('rejects removed custom preferences and oversized usage requests', () => {
		const period = { value: 2001, unit: 'month' as const };

		expect(
			usagePeriodPreferenceSchema.safeParse({
				mode: 'custom',
				customPeriod: period,
			}).success,
		).toBe(false);
		expect(usageFilterSchema.safeParse({ period }).success).toBe(false);
	});

	it('keeps coarsened date series ordered after linear-time generation', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-03T23:30:00Z'));
		const dates = generateDateSeries({ value: 30, unit: 'day' }, 'hour');

		expect(dates).toHaveLength(720);
		expect([...dates].sort()).toEqual(dates);
	});
});
