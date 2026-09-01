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

	it('flattens nested grid blocks cleanly without leaving stray grid tags', () => {
		const story = {
			title: 'Nested Grid Story',
			code: `<grid>\n  <grid>\n    ### Section in Grid\n\n    Inner text in nested grid.\n  </grid>\n</grid>`,
		};

		const md = generateStoryMarkdown(story, null);

		expect(md).toContain('# Nested Grid Story');
		expect(md).toContain('### Section in Grid');
		expect(md).toContain('Inner text in nested grid.');
		expect(md).not.toContain('<grid');
		expect(md).not.toContain('</grid>');
	});

	it('renders table blocks as standard Markdown tables with escaped backslashes, pipes, and punctuation', () => {
		const story = {
			title: 'Financial Summary',
			code: '<table query_id="q_revenue" title="Revenue By Department" />',
		};

		const queryData = {
			q_revenue: {
				columns: ['department', 'revenue', 'notes'],
				data: [
					{ department: 'Engineering', revenue: 150000, notes: 'Path C:\\proj | team A' },
					{ department: 'Sales & Marketing', revenue: 320000, notes: 'Target *Q3* [Special]' },
				],
			},
		};

		const md = generateStoryMarkdown(story, queryData);

		expect(md).toContain('### Revenue By Department');
		expect(md).toContain('| Department | Revenue | Notes |');
		expect(md).toContain('| --- | ---: | --- |');
		expect(md).toContain('| Engineering | 150000 | Path C:\\\\proj \\| team A |');
		expect(md).toContain('Target \\*Q3\\* \\[Special\\]');
	});

	it('resolves column casing and applies value_format to chart tables', () => {
		const story = {
			title: 'Analytics Dashboard',
			code: `<chart query_id="q_monthly" chart_type="bar" x_axis_key="MONTH" series='[{"data_key":"REVENUE","label":"Monthly Revenue","value_format":{"prefix":"$"}}]' title="Monthly Growth" />`,
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
		expect(md).toContain('| Month | Monthly Revenue |');
		expect(md).toContain('| 2026-01 | $10,000 |');
		expect(md).toContain('| 2026-02 | $15,000 |');
	});

	it('renders KPI cards selecting the latest date-sorted row, handling multiple series and value_format', () => {
		const story = {
			title: 'KPI Story',
			code: `<chart query_id="q_kpi" chart_type="kpi_card" x_axis_key="DATE" x_axis_type="date" series='[{"data_key":"TOTAL_SALES","label":"Sales","value_format":{"prefix":"$"}},{"data_key":"ACTIVE_USERS","label":"Users"}]' title="Performance" />`,
		};

		const queryData = {
			q_kpi: {
				columns: ['date', 'total_sales', 'active_users'],
				data: [
					{ date: '2026-01-01', total_sales: 1000000, active_users: 50 },
					{ date: '2026-03-01', total_sales: 1250000, active_users: 120 },
					{ date: '2026-02-01', total_sales: 1100000, active_users: 80 },
				],
			},
		};

		const md = generateStoryMarkdown(story, queryData);

		expect(md).toContain('### Performance');
		expect(md).toContain('**Sales:** $1,250,000 · **Users:** 120');
	});

	it('renders fallback KPI series without explicit series configuration, excluding the date axis column', () => {
		const story = {
			title: 'Fallback KPI Story',
			code: '<chart query_id="q_fallback_kpi" chart_type="kpi_card" x_axis_key="DATE" x_axis_type="date" title="Summary Metrics" />',
		};

		const queryData = {
			q_fallback_kpi: {
				columns: ['date', 'revenue', 'users_count'],
				data: [
					{ date: '2026-01-01', revenue: 50000, users_count: 300 },
					{ date: '2026-02-01', revenue: 75000, users_count: 450 },
				],
			},
		};

		const md = generateStoryMarkdown(story, queryData);

		expect(md).toContain('### Summary Metrics');
		expect(md).toContain('**Revenue:** 75,000 · **Users Count:** 450');
		expect(md).not.toContain('**Date:**');
	});

	it('renders map blocks with formatted dates and cells', () => {
		const story = {
			title: 'Map Story',
			code: '<map query_id="q_map" map_type="choropleth" region_key="COUNTRY" value_key="POPULATION" title="Global Reach" />',
		};

		const queryData = {
			q_map: {
				columns: ['country', 'population'],
				data: [
					{ country: 'US', population: 330000000 },
					{ country: 'FR', population: 67000000 },
				],
			},
		};

		const md = generateStoryMarkdown(story, queryData);

		expect(md).toContain('### Global Reach');
		expect(md).toContain('*(Map: Choropleth)*');
		expect(md).toContain('| Country | Population |');
		expect(md).toContain('| US | 330000000 |');
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
