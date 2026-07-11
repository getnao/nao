import { describe, expect, it } from 'vitest';

import { formatPercentAxisTick, formatPercentShare } from '../src/chart-builder';
import { isPercentStackedChartType, isStackedChartType } from '../src/tools/display-chart';

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
