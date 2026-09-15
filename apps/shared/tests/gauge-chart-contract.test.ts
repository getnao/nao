import { describe, expect, it } from 'vitest';

import { buildStoryChartBlock } from '../src/chart-block';
import { parseChartBlock } from '../src/story-segments';
import { validateStoryCode } from '../src/story-validation';
import { displayChart } from '../src/tools';

const gaugeInput = {
	query_id: 'query_1',
	chart_type: 'gauge' as const,
	series: [{ data_key: 'score', value_format: { suffix: '%' } }],
	gauge_segments: [
		{ min: 0, max: 50, color: '#ed6e6e', label: 'Low' },
		{ min: 50, max: 100, color: '#84bb4c', label: 'High' },
	],
	title: 'Health score',
};

describe('gauge chart contract', () => {
	it('accepts one metric and valid static ranges without an x-axis', () => {
		expect(displayChart.InputSchema.safeParse(gaugeInput).success).toBe(true);
		expect(displayChart.chartTypeRequiresXAxisKey('gauge')).toBe(false);
	});

	it('rejects multiple metrics and inverted ranges', () => {
		expect(
			displayChart.InputSchema.safeParse({
				...gaugeInput,
				series: [{ data_key: 'score' }, { data_key: 'target' }],
			}).success,
		).toBe(false);
		expect(
			displayChart.InputSchema.safeParse({
				...gaugeInput,
				gauge_segments: [{ min: 100, max: 0, color: '#ed6e6e' }],
			}).success,
		).toBe(false);
	});

	it('round-trips through a valid story block', () => {
		const block = buildStoryChartBlock(gaugeInput);
		const attributes = block.match(/^<chart\s+([\s\S]*?)\s*\/?>$/)?.[1] ?? '';
		const parsed = parseChartBlock(attributes);

		expect(block).not.toContain('x_axis_key=');
		expect(parsed?.gaugeSegments).toEqual(gaugeInput.gauge_segments);
		expect(validateStoryCode(block)).toEqual([]);
	});
});
