import { describe, expect, it } from 'vitest';

import { extractStorySummary } from '../src/utils/story-summary';

describe('extractStorySummary', () => {
	it('extracts sequential title and body segments from tabbed stories', () => {
		const summary = extractStorySummary(`<tabs>
<tab title="Overview">
Revenue summary text
<chart query_id="q" chart_type="bar" x_axis_key="m" series='[{"data_key":"v"}]' title="Revenue" />
</tab>
<tab title="Details">
More details
</tab>
</tabs>`);

		const textSegments = summary.segments.filter((segment) => segment.type === 'text');

		expect(summary.segments).toEqual([
			{ type: 'text', content: 'Overview' },
			{ type: 'text', content: 'Revenue summary text' },
			{
				type: 'chart',
				chartType: 'bar',
				title: 'Revenue',
			},
			{ type: 'text', content: 'Details' },
			{ type: 'text', content: 'More details' },
		]);
		expect(
			textSegments.every(
				(segment) =>
					!segment.content.includes('<tabs') &&
					!segment.content.includes('<tab ') &&
					!segment.content.includes('</tab'),
			),
		).toBe(true);
	});

	it('treats chart markup in tab titles as text', () => {
		const title = "<chart query_id='fake' chart_type='line' title='Fake' />";
		const summary = extractStorySummary(`<tabs>
<tab title="${title}">
Body text
</tab>
</tabs>`);

		expect(summary.segments).toEqual([
			{ type: 'text', content: title },
			{ type: 'text', content: 'Body text' },
		]);
	});

	it('falls back to the original code when no complete tabs are parsed', () => {
		const code = '<tabs>\nIncomplete story text';

		expect(extractStorySummary(code).segments).toEqual([{ type: 'text', content: code }]);
	});
});
