import { describe, expect, it } from 'vitest';

import { generateStoryHtml } from '../../src/utils/story-html';

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
