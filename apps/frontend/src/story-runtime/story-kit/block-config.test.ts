import { describe, expect, it } from 'vitest';

import { chartBlockConfig, kitBlockFromConfig, resolveShowLegend } from './block-config';
import { diffKitBlock } from '@/lib/story-kit-block-edit';

const RESOLVED = { xAxisKey: 'month', series: [{ key: 'inspections' }] };

describe('story-kit chart legend config', () => {
	it.each([true, false])('round-trips showLegend=%s through the chart block config', (showLegend) => {
		const config = chartBlockConfig('bar', 'q1', 'Inspections', RESOLVED, { showLegend });

		expect(config.show_legend).toBe(showLegend);
		expect(kitBlockFromConfig(config).props.showLegend).toBe(showLegend);
	});

	it('leaves showLegend unset when the story does not set it', () => {
		const config = chartBlockConfig('bar', 'q1', 'Inspections', RESOLVED, {});

		expect(config).not.toHaveProperty('show_legend');
		expect(kitBlockFromConfig(config).props).not.toHaveProperty('showLegend');
	});

	it('defaults the legend to shown only for pies and multi-series charts', () => {
		const twoSeries = { xAxisKey: 'month', series: [{ key: 'inspections' }, { key: 'failures' }] };

		expect(resolveShowLegend('bar', RESOLVED)).toBe(false);
		expect(resolveShowLegend('pie', RESOLVED)).toBe(true);
		expect(resolveShowLegend('bar', twoSeries)).toBe(true);
		expect(resolveShowLegend('bar', twoSeries, false)).toBe(false);
		expect(resolveShowLegend('bar', RESOLVED, true)).toBe(true);
	});

	it('leaves the block untouched when the dialog keeps the default legend', () => {
		const showLegend = resolveShowLegend('bar', RESOLVED);
		const original = chartBlockConfig('bar', 'q1', 'Inspections', RESOLVED, { showLegend });
		const block = { component: 'BarChart' as const, props: {} };

		expect(diffKitBlock(block, original, { ...original })).toBeNull();
		expect(diffKitBlock(block, original, { ...original, show_legend: true })).toEqual({
			set: { showLegend: true },
			unset: [],
		});
	});

	it('writes showLegend on the block when the dialog toggles the legend', () => {
		const original = chartBlockConfig('bar', 'q1', 'Inspections', RESOLVED, {});
		const block = { component: 'BarChart' as const, props: {} };

		expect(diffKitBlock(block, original, { ...original, show_legend: false })).toEqual({
			set: { showLegend: false },
			unset: [],
		});
	});
});
