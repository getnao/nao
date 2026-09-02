import { describe, expect, it } from 'vitest';

import { MAX_USAGE_CHART_BUCKETS, resolveUsageChartGranularity, USAGE_PERIOD_PRESETS } from '../src/types/usage';
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
});
