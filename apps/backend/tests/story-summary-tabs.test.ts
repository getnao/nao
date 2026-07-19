import { describe, expect, it } from 'vitest';

import { extractStorySummary } from '../src/utils/story-summary';

describe('extractStorySummary', () => {
	it('flattens tabbed stories before extracting summary segments', () => {
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

		expect(
			textSegments.every(
				(segment) =>
					!segment.content.includes('<tabs') &&
					!segment.content.includes('<tab ') &&
					!segment.content.includes('</tab'),
			),
		).toBe(true);
		expect(summary.segments).toContainEqual({
			type: 'chart',
			chartType: 'bar',
			title: 'Revenue',
		});
		expect(
			textSegments.some(
				(segment) => segment.content.includes('Overview') || segment.content.includes('Revenue summary text'),
			),
		).toBe(true);
	});
});
