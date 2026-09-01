import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({
	db: {},
}));

import { buildStoryDownloadFile } from '../src/utils/story-download';
import { generateStoryMarkdown } from '../src/utils/story-markdown';

describe('generateStoryMarkdown', () => {
	it('exports story title, text blocks, and headings as Markdown', () => {
		const story = {
			title: 'Sales Strategy Report',
			code: `## Executive Summary\n\nOur sales grew by **25%** this quarter.\n\n- North America: Strong lead\n- EMEA: Steady growth\n- APAC: Emerging market`,
		};

		const md = generateStoryMarkdown(story, null);

		expect(md).toContain('# Sales Strategy Report');
		expect(md).toContain('## Executive Summary');
		expect(md).toContain('Our sales grew by **25%** this quarter.');
		expect(md).toContain('- North America: Strong lead');
	});

	it('flattens story tabs into markdown section headings', () => {
		const story = {
			title: 'Multi-Tab Story',
			code: `<tabs>\n  <tab title="Overview">\n    This is the overview tab.\n  </tab>\n  <tab title="Details">\n    Here are the deep dive details.\n  </tab>\n</tabs>`,
		};

		const md = generateStoryMarkdown(story, null);

		expect(md).toContain('# Multi-Tab Story');
		expect(md).toContain('## Overview');
		expect(md).toContain('This is the overview tab.');
		expect(md).toContain('## Details');
		expect(md).toContain('Here are the deep dive details.');
	});

	it('renders table blocks as standard Markdown tables', () => {
		const story = {
			title: 'Financial Summary',
			code: '<table query_id="q_revenue" title="Revenue By Department" />',
		};

		const queryData = {
			q_revenue: {
				columns: ['department', 'revenue', 'headcount'],
				data: [
					{ department: 'Engineering', revenue: 150000, headcount: 45 },
					{ department: 'Sales & Marketing', revenue: 320000, headcount: 30 },
				],
			},
		};

		const md = generateStoryMarkdown(story, queryData);

		expect(md).toContain('### Revenue By Department');
		expect(md).toContain('| Department | Revenue | Headcount |');
		expect(md).toContain('| --- | ---: | ---: |');
		expect(md).toContain('| Engineering | 150000 | 45 |');
		expect(md).toContain('| Sales & Marketing | 320000 | 30 |');
	});

	it('renders chart blocks with metadata and series data tables', () => {
		const story = {
			title: 'Analytics Dashboard',
			code: '<chart query_id="q_monthly" chart_type="bar" x_axis_key="month" series=\'[{"data_key":"revenue","label":"Revenue"}]\' title="Monthly Growth" />',
		};

		const queryData = {
			q_monthly: {
				columns: ['month', 'revenue'],
				data: [
					{ month: '2026-01', revenue: 10000 },
					{ month: '2026-02', revenue: 15000 },
				],
			},
		};

		const md = generateStoryMarkdown(story, queryData);

		expect(md).toContain('### Monthly Growth');
		expect(md).toContain('*(Chart: Bar)*');
		expect(md).toContain('| Month | Revenue |');
		expect(md).toContain('| 2026-01 | 10,000 |');
		expect(md).toContain('| 2026-02 | 15,000 |');
	});

	it('renders KPI cards as highlighted bold metrics', () => {
		const story = {
			title: 'KPI Story',
			code: '<chart query_id="q_kpi" chart_type="kpi_card" series=\'[{"data_key":"total_sales"}]\' title="Total Revenue" />',
		};

		const queryData = {
			q_kpi: {
				columns: ['total_sales'],
				data: [{ total_sales: 1250000 }],
			},
		};

		const md = generateStoryMarkdown(story, queryData);

		expect(md).toContain('### Total Revenue');
		expect(md).toContain('**1,250,000**');
	});

	it('integrates with buildStoryDownloadFile for format md', async () => {
		const result = await buildStoryDownloadFile(
			'md',
			'Q3 Executive Report',
			'## Section 1\n\nReport body text.',
			null,
		);

		expect(result.filename).toMatch(/^q3-executive-report-\d{4}-\d{2}-\d{2}\.md$/);
		expect(result.mimeType).toBe('text/markdown');
		expect(result.buffer.toString('utf8')).toContain('# Q3 Executive Report');
		expect(result.buffer.toString('utf8')).toContain('## Section 1');
	});
});
