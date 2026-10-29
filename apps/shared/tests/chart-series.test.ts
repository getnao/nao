import { describe, expect, it } from 'vitest';

import { shouldShowLegendByDefault } from '../src/chart-series';

describe('shouldShowLegendByDefault', () => {
	it('hides the legend of a single-series chart', () => {
		expect(shouldShowLegendByDefault('bar', [{ data_key: 'inspections' }])).toBe(false);
		expect(shouldShowLegendByDefault('line', [{ data_key: 'inspections' }])).toBe(false);
	});

	it('shows the legend once the chart is split into several series', () => {
		expect(shouldShowLegendByDefault('stacked_bar', [{ data_key: 'acme' }, { data_key: 'globex' }])).toBe(true);
	});

	it('always shows the legend of pie and donut charts, whose slices are the categories', () => {
		expect(shouldShowLegendByDefault('pie', [{ data_key: 'inspections' }])).toBe(true);
		expect(shouldShowLegendByDefault('donut', [{ data_key: 'inspections' }])).toBe(true);
	});
});
