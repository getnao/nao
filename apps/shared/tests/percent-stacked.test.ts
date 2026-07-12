import { describe, expect, it } from 'vitest';

import { formatPercentAxisTick, formatPercentShare, sumPercentStackBase } from '../src/chart-builder';
import { chartTypeRequiresXAxisKey, isPercentStackedChartType, isStackedChartType } from '../src/tools/display-chart';

describe('isStackedChartType', () => {
	it('recognises absolute and normalized stacked types', () => {
		expect(isStackedChartType('stacked_bar')).toBe(true);
		expect(isStackedChartType('stacked_bar_100')).toBe(true);
		expect(isStackedChartType('stacked_area')).toBe(true);
		expect(isStackedChartType('stacked_area_100')).toBe(true);
	});

	it('rejects non-stacked types', () => {
		expect(isStackedChartType('bar')).toBe(false);
		expect(isStackedChartType('area')).toBe(false);
		expect(isStackedChartType('pie')).toBe(false);
	});
});

describe('isPercentStackedChartType', () => {
	it('matches only the 100% variants', () => {
		expect(isPercentStackedChartType('stacked_bar_100')).toBe(true);
		expect(isPercentStackedChartType('stacked_area_100')).toBe(true);
		expect(isPercentStackedChartType('stacked_bar')).toBe(false);
		expect(isPercentStackedChartType('stacked_area')).toBe(false);
		expect(isPercentStackedChartType('bar')).toBe(false);
	});
});

describe('chartTypeRequiresXAxisKey', () => {
	it('requires an x-axis key for both 100% stacked variants', () => {
		expect(chartTypeRequiresXAxisKey('stacked_bar_100')).toBe(true);
		expect(chartTypeRequiresXAxisKey('stacked_area_100')).toBe(true);
	});

	it('does not require one for pie or kpi cards', () => {
		expect(chartTypeRequiresXAxisKey('pie')).toBe(false);
		expect(chartTypeRequiresXAxisKey('kpi_card')).toBe(false);
	});
});

describe('sumPercentStackBase', () => {
	it('sums the stacked series values', () => {
		expect(sumPercentStackBase([{ value: 10 }, { value: 20 }])).toBe(30);
	});

	it('excludes an already-aggregated total series from the denominator', () => {
		const base = sumPercentStackBase([{ value: 10 }, { value: 20 }, { value: 30, isTotal: true }]);
		expect(base).toBe(30);
		// Each part is measured against the non-total base, so shares sum to 100%.
		expect(formatPercentShare(10, base)).toBe('33.3%');
		expect(formatPercentShare(20, base)).toBe('66.7%');
	});
});

describe('formatPercentAxisTick', () => {
	it('formats a 0-1 ratio as a whole percentage', () => {
		expect(formatPercentAxisTick(0)).toBe('0%');
		expect(formatPercentAxisTick(0.25)).toBe('25%');
		expect(formatPercentAxisTick(1)).toBe('100%');
	});
});

describe('formatPercentShare', () => {
	it('computes a value share of the total', () => {
		expect(formatPercentShare(25, 100)).toBe('25%');
		expect(formatPercentShare(1, 3)).toBe('33.3%');
		expect(formatPercentShare(2, 3)).toBe('66.7%');
	});

	it('returns 0% when the total is zero', () => {
		expect(formatPercentShare(0, 0)).toBe('0%');
		expect(formatPercentShare(5, 0)).toBe('0%');
	});

	it('drops the decimal for whole shares', () => {
		expect(formatPercentShare(50, 200)).toBe('25%');
	});
});
