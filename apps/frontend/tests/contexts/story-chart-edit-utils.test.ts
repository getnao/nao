import { describe, expect, it } from 'vitest';

import { replaceUniqueStoryBlockTag } from '@/contexts/story-chart-edit-utils';

const chartTag = '<chart query_id="q1" chart_type="bar" x_axis_key="date" />';
const nextChartTag = '<chart query_id="q1" chart_type="line" x_axis_key="date" />';

describe('replaceUniqueStoryBlockTag', () => {
	it.each([
		['replaces the matching block tag when it is unique', chartTag, nextChartTag],
		[
			'replaces a table block tag too',
			`<table query_id="q1" title="A" />`,
			`<table query_id="q1" title="A" formatting='{"x":{"type":"color-scale"}}' />`,
		],
	])('%s', (_scenario, rawTag, nextTag) => {
		const storyCode = `Intro\n\n${rawTag}\n\nOutro`;

		expect(replaceUniqueStoryBlockTag(storyCode, rawTag, nextTag)).toBe(`Intro\n\n${nextTag}\n\nOutro`);
	});

	it('rejects with a neutral message when the tag is missing', () => {
		expect(() =>
			replaceUniqueStoryBlockTag('Intro only', '<chart query_id="q1" />', '<chart query_id="q2" />'),
		).toThrow('Could not locate the item in the current story version.');
	});

	it('rejects with a neutral message when identical tags make the target ambiguous', () => {
		const storyCode = `${chartTag}\n\nSome text\n\n${chartTag}`;

		expect(() => replaceUniqueStoryBlockTag(storyCode, chartTag, nextChartTag)).toThrow(
			'Could not uniquely identify the item because the same tag appears more than once.',
		);
	});
});
