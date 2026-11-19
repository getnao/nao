import '../../src/env';

import { describe, expect, it, vi } from 'vitest';

import { generateStoryMarkdown } from '../../src/utils/story-markdown';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

const CHART =
	'<chart query_id="q1" chart_type="bar" x_axis_key="month" series=\'[{"data_key":"revenue"}]\' title="Revenue [EUR]" />';
const QUERY_DATA = {
	q1: {
		columns: ['month', 'revenue'],
		data: [
			{ month: 'Jan', revenue: 10 },
			{ month: 'Feb', revenue: 20 },
		],
	},
};
const IMAGE_PATTERN = /!\[Revenue \\\[EUR\\\]\]\((https?:\/\/[^)]+\/c\/story\/[\w-]+\.png)\)/;

describe('generateStoryMarkdown', () => {
	it('renders tabs as headings and query results as escaped Markdown tables', async () => {
		const markdown = await generateStoryMarkdown(
			{
				title: 'Quarterly report',
				code: '<tab title="Overview">\nIntro\n\n<table query_id="q2" title="Results" />\n</tab>',
			},
			{ q2: { columns: ['name', 'notes'], data: [{ name: 'A | B', notes: 'first\nsecond' }] } },
		);

		expect(markdown).toBe(
			[
				'# Quarterly report',
				'## Overview',
				'Intro',
				'**Results**',
				'| Name | Notes |\n| --- | --- |\n| A \\| B | first second |',
			].join('\n\n'),
		);
	});

	it.each([
		{ block: '<table query_id="missing" title="Details" />', expected: '**Details**\n\n_Table data unavailable._' },
		{ block: CHART.replace('q1', 'missing'), expected: '**Revenue [EUR]**\n\n_Chart unavailable._' },
	])('marks $expected when its data is missing', async ({ block, expected }) => {
		const markdown = await generateStoryMarkdown({ title: '', code: block }, QUERY_DATA);

		expect(markdown).toBe(expected);
	});

	it('links charts to a stored image that a second export reuses', async () => {
		const story = { title: 'Report', code: `<grid cols="2">${CHART}</grid>` };

		const first = (await generateStoryMarkdown(story, QUERY_DATA)).match(IMAGE_PATTERN);
		const second = (await generateStoryMarkdown(story, QUERY_DATA)).match(IMAGE_PATTERN);

		expect(first?.[1]).toBeDefined();
		expect(second?.[1]).toBe(first?.[1]);
	});
});
