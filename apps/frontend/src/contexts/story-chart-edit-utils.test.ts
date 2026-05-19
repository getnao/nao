import { describe, expect, it } from 'vitest';

import { replaceUniqueChartTag } from './story-chart-edit-utils';

describe('replaceUniqueChartTag', () => {
	it('replaces the matching chart tag when it is unique', () => {
		const rawTag = '<chart query_id="q1" chart_type="bar" x_axis_key="date" />';
		const nextTag = '<chart query_id="q1" chart_type="line" x_axis_key="date" />';
		const storyCode = `Intro\n\n${rawTag}\n\nOutro`;

		expect(replaceUniqueChartTag(storyCode, rawTag, nextTag)).toBe(`Intro\n\n${nextTag}\n\nOutro`);
	});

	it('rejects when the chart tag is missing', () => {
		expect(() => replaceUniqueChartTag('Intro only', '<chart query_id="q1" />', '<chart query_id="q2" />')).toThrow(
			'Could not locate the chart in the current story version.',
		);
	});

	it('rejects when identical chart tags make the target ambiguous', () => {
		const rawTag = '<chart query_id="q1" chart_type="bar" x_axis_key="date" />';
		const nextTag = '<chart query_id="q1" chart_type="line" x_axis_key="date" />';
		const storyCode = `${rawTag}\n\nSome text\n\n${rawTag}`;

		expect(() => replaceUniqueChartTag(storyCode, rawTag, nextTag)).toThrow(
			'Could not uniquely identify the chart because the same chart tag appears more than once.',
		);
	});
});
