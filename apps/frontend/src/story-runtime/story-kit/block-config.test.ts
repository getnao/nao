import { describe, expect, it } from 'vitest';

import { chartBlockConfig, kitBlockFromConfig } from './block-config';
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

	it('writes showLegend on the block when the dialog toggles the legend', () => {
		const original = chartBlockConfig('bar', 'q1', 'Inspections', RESOLVED, {});
		const block = { component: 'BarChart' as const, props: {} };

		expect(diffKitBlock(block, original, { ...original, show_legend: false })).toEqual({
			set: { showLegend: false },
			unset: [],
		});
	});
});
