import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));

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

describe('generateStoryHtml markdown safety', () => {
	it('keeps safe links while removing unsafe links and images', async () => {
		const html = await generateStoryHtml(
			{
				title: 'Story',
				code: [
					'[Safe](https://example.com)',
					'[Unsafe](javascript:alert(1))',
					'![Remote image](https://internal.example.com/tracker.png)',
				].join('\n\n'),
			},
			null,
		);

		expect(html).toContain('<a href="https://example.com">Safe</a>');
		expect(html).toContain('Unsafe');
		expect(html).toContain('Remote image');
		expect(html).not.toContain('javascript:');
		expect(html).not.toContain('internal.example.com');
		expect(html).not.toContain('<img');
	});
});
