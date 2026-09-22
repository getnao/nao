import { describe, expect, it } from 'vitest';

import { generateStoryHtml } from '../src/utils/story-html';

const CHART_ONE =
	'<chart query_id="q1" chart_type="line" x_axis_key="month" series=\'[{"data_key":"revenue"}]\' title="Revenue" />';
const CHART_TWO =
	'<chart query_id="q2" chart_type="bar" x_axis_key="month" series=\'[{"data_key":"orders"}]\' title="Orders" />';

describe('generateStoryHtml grid flattening', () => {
	it('flattens grids with widths', async () => {
		const html = await generateStoryHtml(
			{ title: 'Story', code: `<grid widths="3,1">${CHART_ONE}${CHART_TWO}</grid>` },
			null,
		);

		expect(html).not.toContain('grid-template-columns');
		expect(html).toContain('Revenue');
		expect(html).toContain('Orders');
	});

	it('flattens grids without widths', async () => {
		const html = await generateStoryHtml(
			{ title: 'Story', code: `<grid cols="2">${CHART_ONE}${CHART_TWO}</grid>` },
			null,
		);

		expect(html).not.toContain('grid-template-columns');
		expect(html).toContain('Revenue');
		expect(html).toContain('Orders');
	});
});
