import { buildStoryChartBlock, buildStoryMapBlock, buildStoryTableBlock } from '@nao/shared';
import { describe, expect, it } from 'vitest';

import { extractStorySummary } from '../src/utils/story-summary';

describe('extractStorySummary', () => {
	it('extracts sequential title and body segments from tabbed stories', () => {
		const summary = extractStorySummary(`<tab title="Overview">
Revenue summary text
<chart query_id="q" chart_type="bar" x_axis_key="m" series='[{"data_key":"v"}]' title="Revenue" />
</tab>
<tab title="Details">
More details
</tab>`);

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
			textSegments.every((segment) => !segment.content.includes('<tab ') && !segment.content.includes('</tab')),
		).toBe(true);
	});

	it('treats chart markup in tab titles as text', () => {
		const title = "<chart query_id='fake' chart_type='line' title='Fake' />";
		const summary = extractStorySummary(`<tab title="${title}">
Body text
</tab>`);

		expect(summary.segments).toEqual([
			{ type: 'text', content: title },
			{ type: 'text', content: 'Body text' },
		]);
	});

	it('reads chart titles and kpi series that contain escaped quotes', () => {
		const chart = buildStoryChartBlock({
			query_id: 'q',
			chart_type: 'kpi_card',
			series: [
				{ data_key: 'ltv', label: "Customer's LTV" },
				{ data_key: 'orders', label: 'Orders' },
			],
			title: 'Top "hero" products',
		});

		expect(extractStorySummary(chart).segments).toEqual([
			{ type: 'chart', chartType: 'kpi_card', title: 'Top "hero" products', kpiCount: 2 },
		]);
	});

	it('reads table and map titles that contain escaped quotes', () => {
		const table = buildStoryTableBlock({ query_id: 'q', title: 'Orders "late"' });
		const map = buildStoryMapBlock({
			query_id: 'q',
			map_type: 'points',
			latitude_key: 'lat',
			longitude_key: 'lng',
			title: "Stores' reach",
		});

		expect(extractStorySummary(`${table}\n\n${map}`).segments).toEqual([
			{ type: 'table', title: 'Orders "late"' },
			{ type: 'map', mapType: 'points', title: "Stores' reach" },
		]);
	});

	it('falls back to the original code when no complete tabs are parsed', () => {
		const code = '<tab title="Overview">\nIncomplete story text';

		expect(extractStorySummary(code).segments).toEqual([{ type: 'text', content: code }]);
	});
});
