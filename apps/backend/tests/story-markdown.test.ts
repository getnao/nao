import { describe, expect, it, vi } from 'vitest';

import { generateStoryMarkdown } from '../src/utils/story-markdown';

vi.mock('../src/utils/headless-browser', () => ({
	getBrowser: vi.fn(),
}));

vi.mock('../src/utils/story-html', () => ({
	generateStoryHtml: vi.fn(),
}));

describe('generateStoryMarkdown', () => {
	it('renders tabbed Markdown and query-backed tables', async () => {
		const markdown = await generateStoryMarkdown(
			{
				title: 'Quarterly report',
				code: `<tab title="Overview">
Intro

<table query_id="q1" title="Results" />
</tab>`,
			},
			{
				q1: {
					columns: ['name', 'notes', 'amount'],
					data: [{ name: 'A | B', notes: 'first\nsecond', amount: null }],
				},
			},
		);

		expect(markdown).toBe(`# Quarterly report

## Overview

Intro

**Results**

| name | notes | amount |
| --- | --- | --- |
| A \\| B | first<br>second | NULL |`);
	});

	it('renders an unavailable message when table data is missing', async () => {
		const markdown = await generateStoryMarkdown(
			{
				title: 'Report',
				code: '<table query_id="missing" title="Details" />',
			},
			null,
		);

		expect(markdown).toContain('**Details**\n\n_Table data unavailable._');
	});
});
