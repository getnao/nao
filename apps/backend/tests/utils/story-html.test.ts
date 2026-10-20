import { DEFAULT_COLORS } from '@nao/shared';
import { DEFAULT_DARK_STORY_THEME, DEFAULT_STORY_THEME, type StoryThemePair } from '@nao/shared/story-theme';
import { describe, expect, it } from 'vitest';

import { generateStoryEmailHtml, generateStoryHtml } from '../../src/utils/story-html';

const CHART_ONE =
	'<chart query_id="q1" chart_type="line" x_axis_key="month" series=\'[{"data_key":"revenue"}]\' title="Revenue" />';
const CHART_TWO =
	'<chart query_id="q2" chart_type="bar" x_axis_key="month" series=\'[{"data_key":"orders"}]\' title="Orders" />';

describe('generateStoryHtml grid flattening', () => {
	it.each([
		{ variant: 'with widths', attributes: 'widths="3,1"' },
		{ variant: 'without widths', attributes: 'cols="2"' },
	])('flattens grids $variant', async ({ attributes }) => {
		const html = await generateStoryHtml(
			{ title: 'Story', code: `<grid ${attributes}>${CHART_ONE}${CHART_TWO}</grid>` },
			null,
		);

		expect(html).not.toContain('grid-template-columns');
		expect(html).toContain('Revenue');
		expect(html).toContain('Orders');
	});
});

const THEME: StoryThemePair = {
	light: {
		...DEFAULT_STORY_THEME,
		surfaces: { page: '#fbf7ef', sunken: '#f1e9da' },
		text: { ...DEFAULT_STORY_THEME.text, headingColor: '#0b1f3a', bodyColor: '#2d3a4f', bodyFont: 'Lora, serif' },
		table: { ...DEFAULT_STORY_THEME.table, headerBackground: '#e8dcc4' },
		charts: { ...DEFAULT_STORY_THEME.charts, series: ['#c2410c', '#0f766e', '#7c3aed'] },
	},
	dark: DEFAULT_DARK_STORY_THEME,
};

const THEMED_STORY = {
	title: 'Story',
	code: `# Revenue\n\n${CHART_TWO}\n\n<table query_id="q2" title="Orders" />`,
};
const QUERY_DATA = { q2: { columns: ['month', 'orders'], data: [{ month: 'Jan', orders: 3 }] } };

describe('generateStoryHtml theme', () => {
	it('keeps the default look when the story has no theme', async () => {
		const html = await generateStoryHtml(THEMED_STORY, QUERY_DATA);

		expect(html).toContain('color:#111827');
		expect(html).toContain(`fill="${DEFAULT_COLORS[0]}"`);
		expect(html).not.toContain('#fbf7ef');
	});

	it('paints the document, tables and chart series with the light theme', async () => {
		const html = await generateStoryHtml(THEMED_STORY, QUERY_DATA, null, undefined, { theme: THEME });

		expect(html).toContain('background:#fbf7ef');
		expect(html).toContain('@page{background:#fbf7ef}');
		expect(html).toContain('color:#0b1f3a');
		expect(html).toContain('font-family:Lora, serif');
		expect(html).toContain('background:#e8dcc4');
		expect(html).toContain('fill="#c2410c"');
		expect(html).toContain('--background:#fbf7ef');
		expect(html).not.toContain(DEFAULT_DARK_STORY_THEME.surfaces.page);
	});

	it('inlines the theme into emailed stories, where stylesheets are stripped', async () => {
		const { html } = await generateStoryEmailHtml(THEMED_STORY, QUERY_DATA, null, undefined, THEME);

		expect(html).toContain('color:#0b1f3a');
		expect(html).toContain('background:#e8dcc4');
	});
});

describe('generateStoryHtml tabs', () => {
	it('renders each tab as a titled section with its content', async () => {
		const html = await generateStoryHtml(
			{
				title: 'Tabbed story',
				code: `<tab title="Overview">
## Summary
Hello overview
</tab>
<tab title="Details">
Some details text
</tab>`,
			},
			null,
		);

		expect(html).toContain('Overview');
		expect(html).toContain('Details');
		expect(html).toContain('Hello overview');
		expect(html).toContain('Some details text');
	});

	it('formats KPI values with the series value format', async () => {
		const html = await generateStoryHtml(
			{
				title: 'Revenue story',
				code: `<chart query_id="q1" chart_type="kpi_card" x_axis_key="month" series='[{"data_key":"revenue","color":"#2563eb","value_format":{"d3_format":",.2f","prefix":"$","suffix":" USD"}}]' />`,
			},
			{ q1: { data: [{ month: 'July', revenue: 1234.5 }], columns: ['month', 'revenue'] } },
		);

		expect(html).toContain('$1,234.50 USD');
	});
});
