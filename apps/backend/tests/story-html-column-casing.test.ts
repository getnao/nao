import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/utils/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { renderChartToSvg } from '../src/components/generate-chart';
import { generateStoryHtml } from '../src/utils/story-html';

/**
 * A story authored against one execution (e.g. Snowflake, which uppercases
 * unquoted identifiers) can be exported with query data from a re-execution
 * whose column casing differs (e.g. DuckDB preserves aliases as written).
 * Exports must resolve chart keys case-insensitively like the frontend does.
 */
const storyCode = `
# Repro

<chart query_id="query_repro" chart_type="kpi_card" series='[{"data_key":"NEW_ACCOUNTS","label":"Accounts"}]' />

<chart query_id="query_repro" chart_type="bar" title="New Accounts per Month" x_axis_key="MONTH" x_axis_type="date" series='[{"data_key":"NEW_ACCOUNTS","label":"New accounts"}]' />
`;

const rows = [
	{ month: '2025-09', new_accounts: 153 },
	{ month: '2025-10', new_accounts: 201 },
	{ month: '2025-11', new_accounts: 178 },
];

const queryData = { query_repro: { columns: Object.keys(rows[0]), data: rows } };

const countBarShapes = (html: string) => (html.match(/recharts-rectangle[^>]*?d="/g) ?? []).length;

describe('story export column-name casing', () => {
	it('renders bar shapes when chart keys differ in case from the row keys', async () => {
		const html = await generateStoryHtml({ title: 'Repro', code: storyCode }, queryData);
		expect(countBarShapes(html)).toBe(rows.length);
	});

	it('renders KPI values when series keys differ in case from the row keys', async () => {
		const html = await generateStoryHtml({ title: 'Repro', code: storyCode }, queryData);
		expect(html).toContain('178');
	});

	it('resolves keys case-insensitively in renderChartToSvg', () => {
		const svg = renderChartToSvg({
			config: {
				chart_type: 'bar',
				x_axis_key: 'MONTH',
				x_axis_type: 'category',
				title: 'Casing',
				series: [{ data_key: 'NEW_ACCOUNTS' }],
			},
			data: rows,
		});
		expect(countBarShapes(svg)).toBe(rows.length);
	});
});
