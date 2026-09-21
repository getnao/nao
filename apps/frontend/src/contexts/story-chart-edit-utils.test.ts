import { describe, expect, it } from 'vitest';

import { replaceUniqueStoryBlockTag } from './story-chart-edit-utils';

describe('replaceUniqueStoryBlockTag', () => {
	it('replaces the matching block tag when it is unique', () => {
		const rawTag = '<chart query_id="q1" chart_type="bar" x_axis_key="date" />';
		const nextTag = '<chart query_id="q1" chart_type="line" x_axis_key="date" />';
		const storyCode = `Intro\n\n${rawTag}\n\nOutro`;

		expect(replaceUniqueStoryBlockTag(storyCode, rawTag, nextTag)).toBe(`Intro\n\n${nextTag}\n\nOutro`);
	});

	it('replaces a table block tag too', () => {
		const rawTag = `<table query_id="q1" title="A" />`;
		const nextTag = `<table query_id="q1" title="A" formatting='{"x":{"type":"color-scale"}}' />`;
		const storyCode = `Intro\n\n${rawTag}\n\nOutro`;

		expect(replaceUniqueStoryBlockTag(storyCode, rawTag, nextTag)).toBe(`Intro\n\n${nextTag}\n\nOutro`);
	});

	it('rejects with a neutral message when the tag is missing', () => {
		expect(() =>
			replaceUniqueStoryBlockTag('Intro only', '<chart query_id="q1" />', '<chart query_id="q2" />'),
		).toThrow('Could not locate the item in the current story version.');
	});

	it('rejects with a neutral message when identical tags make the target ambiguous', () => {
		const rawTag = '<chart query_id="q1" chart_type="bar" x_axis_key="date" />';
		const nextTag = '<chart query_id="q1" chart_type="line" x_axis_key="date" />';
		const storyCode = `${rawTag}\n\nSome text\n\n${rawTag}`;

		expect(() => replaceUniqueStoryBlockTag(storyCode, rawTag, nextTag)).toThrow(
			'Could not uniquely identify the item because the same tag appears more than once.',
		);
	});
});
