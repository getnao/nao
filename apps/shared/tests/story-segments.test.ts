import { describe, expect, it } from 'vitest';

import { buildStoryChartBlock, buildStoryFilterBlock, buildStoryMapBlock } from '../src/chart-block';
import {
	getGridTemplateColumns,
	getStoryFiltersFromCode,
	groupBlocksIntoGrid,
	insertGridColumn,
	mapBlockToInput,
	parseChartBlock,
	parseMapBlock,
	popGridColumn,
	popGridColumns,
	previewGridColumns,
	reorderGridColumns,
	resizeGridColumns,
	resolveGridWidths,
	setGridColumnsMarkup,
	splitCodeIntoSegments,
	splitGridColumnsRaw,
} from '../src/story-segments';

const CHART_ONE =
	'<chart query_id="q1" chart_type="line" x_axis_key="month" series=\'[{"data_key":"revenue"}]\' title="Revenue" />';
const CHART_TWO =
	'<chart query_id="q2" chart_type="bar" x_axis_key="month" series=\'[{"data_key":"orders"}]\' title="Orders" />';
const CHART_THREE =
	'<chart query_id="q3" chart_type="area" x_axis_key="month" series=\'[{"data_key":"profit"}]\' title="Profit" />';

describe('grid widths', () => {
	it('resolves valid widths', () => {
		expect(resolveGridWidths('3,1', 2)).toEqual([3, 1]);
	});

	it('returns null when the count is wrong', () => {
		expect(resolveGridWidths('3,1', 3)).toBeNull();
	});

	it('returns null for invalid values', () => {
		expect(resolveGridWidths('1.5,-1', 2)).toBeNull();
	});

	it('returns null when absent', () => {
		expect(resolveGridWidths(undefined, 2)).toBeNull();
	});

	it('builds a CSS grid template', () => {
		expect(getGridTemplateColumns([3, 1])).toBe('3fr 1fr');
	});
});

describe('groupBlocksIntoGrid', () => {
	it('groups two blocks in left-to-right order', () => {
		const markup = groupBlocksIntoGrid(CHART_ONE, CHART_TWO);

		expect(markup).toBe(`<grid widths="1,1">\n${CHART_ONE}\n\n${CHART_TWO}\n</grid>`);
		expect(splitCodeIntoSegments(markup)).toMatchObject([
			{
				type: 'grid',
				widths: [1, 1],
				children: [
					{ type: 'chart', chart: { title: 'Revenue' } },
					{ type: 'chart', chart: { title: 'Orders' } },
				],
			},
		]);
	});
});

describe('insertGridColumn', () => {
	it('gives an inserted column one third while preserving existing proportions', () => {
		const markup = insertGridColumn(`<grid widths="3,1">\n${CHART_ONE}\n\n${CHART_TWO}\n</grid>`, CHART_THREE, 1);
		const { columns, widths } = splitGridColumnsRaw(markup);
		const total = widths.reduce((sum, width) => sum + width, 0);

		expect(columns).toEqual([CHART_ONE, CHART_THREE, CHART_TWO]);
		expect(widths).toEqual([3, 2, 1]);
		expect(widths[1] / total).toBe(1 / 3);
		expect(widths[0] / widths[2]).toBe(3);
		expect(splitCodeIntoSegments(markup)[0]).toMatchObject({
			type: 'grid',
			widths: [3, 2, 1],
			children: [
				{ type: 'chart', chart: { title: 'Revenue' } },
				{ type: 'chart', chart: { title: 'Profit' } },
				{ type: 'chart', chart: { title: 'Orders' } },
			],
		});
	});

	it('appends to equal columns with equal thirds', () => {
		const grid = `<grid widths="1,1">\n${CHART_ONE}\n\n${CHART_TWO}\n</grid>`;
		const { columns, widths } = splitGridColumnsRaw(insertGridColumn(grid, CHART_THREE, 2));

		expect(columns).toEqual([CHART_ONE, CHART_TWO, CHART_THREE]);
		expect(widths).toEqual([1, 1, 1]);
		expect(widths[2] / widths.reduce((sum, width) => sum + width, 0)).toBe(1 / 3);
	});

	it('prepends one third while preserving a two-to-one ratio', () => {
		const grid = `<grid widths="2,1">\n${CHART_ONE}\n\n${CHART_TWO}\n</grid>`;
		const { columns, widths } = splitGridColumnsRaw(insertGridColumn(grid, CHART_THREE, 0));
		const total = widths.reduce((sum, width) => sum + width, 0);

		expect(columns).toEqual([CHART_THREE, CHART_ONE, CHART_TWO]);
		expect(widths).toEqual([3, 4, 2]);
		expect(widths[0] / total).toBe(1 / 3);
		expect(widths[1] / widths[2]).toBe(2);
	});

	it('clamps insertion indexes to the grid edges', () => {
		const grid = `<grid widths="3,1">\n${CHART_ONE}\n\n${CHART_TWO}\n</grid>`;

		expect(splitGridColumnsRaw(insertGridColumn(grid, CHART_THREE, -1)).columns).toEqual([
			CHART_THREE,
			CHART_ONE,
			CHART_TWO,
		]);
		expect(splitGridColumnsRaw(insertGridColumn(grid, CHART_THREE, 100)).columns).toEqual([
			CHART_ONE,
			CHART_TWO,
			CHART_THREE,
		]);
	});

	it('returns non-grid input unchanged', () => {
		expect(insertGridColumn(CHART_ONE, CHART_TWO, 1)).toBe(CHART_ONE);
	});
});

describe('resizeGridColumns', () => {
	it.each([
		[0.75, [3, 1]],
		[0.25, [1, 3]],
		[0.5, [1, 1]],
		[0.66, [2, 1]],
		[0.33, [1, 2]],
	])('snaps two columns at target %s', (target, expected) => {
		expect(resizeGridColumns([1, 1], 0, target)).toEqual(expected);
	});

	it('changes only the adjacent columns in a three-column grid', () => {
		const resized = resizeGridColumns([1, 1, 1], 0, 0.5);
		const total = resized.reduce((sum, width) => sum + width, 0);

		expect(resized).toHaveLength(3);
		expect(resized.every((width) => width > 0)).toBe(true);
		expect(Math.round((resized[2] / total) * 12)).toBe(4);
	});

	it('returns the original widths for invalid boundaries or a single column', () => {
		const widths = [1, 1];
		const singleColumn = [1];

		expect(resizeGridColumns(widths, -1, 0.5)).toBe(widths);
		expect(resizeGridColumns(widths, 1, 0.5)).toBe(widths);
		expect(resizeGridColumns(singleColumn, 0, 0.5)).toBe(singleColumn);
	});
});

describe('previewGridColumns', () => {
	it('previews a smooth two-column split', () => {
		const preview = previewGridColumns([1, 1], 0, 0.7);

		expect(preview[0]).toBeCloseTo(0.7);
		expect(preview[1]).toBeCloseTo(0.3);
	});

	it('keeps non-adjacent column fractions unchanged', () => {
		const preview = previewGridColumns([1, 1, 1], 0, 0.5);

		expect(preview[0]).toBeCloseTo(0.5);
		expect(preview[1]).toBeCloseTo(1 / 6);
		expect(preview[2]).toBeCloseTo(1 / 3);
	});

	it('clamps adjacent columns to a minimum fraction', () => {
		const preview = previewGridColumns([1, 1], 0, 0.99);

		expect(preview[1]).toBeCloseTo(0.05);
	});

	it('returns the original widths for an invalid boundary', () => {
		const widths = [1, 1];

		expect(previewGridColumns(widths, 1, 0.5)).toBe(widths);
	});
});

describe('setGridColumnsMarkup', () => {
	it('replaces legacy spans with explicit widths', () => {
		const legacyGrid = `<grid cols="3">
${CHART_ONE}
<div style="grid-column: span 2;">
${CHART_TWO}
</div>
</grid>`;
		const markup = setGridColumnsMarkup(legacyGrid, [1, 2]);

		expect(markup).toContain('<grid widths="1,2">');
		expect(markup).toContain(CHART_ONE);
		expect(markup).toContain(CHART_TWO);
		expect(markup).not.toContain('<div');
		expect(markup).not.toContain('</div>');
		expect(markup).not.toContain('cols=');
	});

	it('replaces cols while keeping both charts intact', () => {
		const markup = setGridColumnsMarkup(`<grid cols="2">\n${CHART_ONE}\n${CHART_TWO}\n</grid>`, [3, 1]);

		expect(markup).toContain('<grid widths="3,1">');
		expect(markup).toContain(CHART_ONE);
		expect(markup).toContain(CHART_TWO);
		expect(markup).not.toContain('cols=');
	});

	it('round-trips through grid parsing', () => {
		const markup = setGridColumnsMarkup(`<grid cols="2">\n${CHART_ONE}\n${CHART_TWO}\n</grid>`, [3, 1]);
		const segments = splitCodeIntoSegments(markup);

		expect(segments[0]).toMatchObject({
			type: 'grid',
			widths: [3, 1],
			children: [{ type: 'chart' }, { type: 'chart' }],
		});
	});
});

describe('splitGridColumnsRaw', () => {
	it('preserves raw chart tags and resolves explicit widths', () => {
		const result = splitGridColumnsRaw(`<grid widths="1,2">${CHART_ONE}${CHART_TWO}</grid>`);

		expect(result).toEqual({
			columns: [CHART_ONE, CHART_TWO],
			widths: [1, 2],
		});
	});

	it('strips legacy span wrappers and derives widths', () => {
		const result = splitGridColumnsRaw(
			`<grid cols="3">${CHART_ONE}<div style="grid-column: span 2;">${CHART_TWO}</div></grid>`,
		);

		expect(result).toEqual({
			columns: [CHART_ONE, CHART_TWO],
			widths: [1, 2],
		});
	});
});

describe('reorderGridColumns', () => {
	it('moves a column and its width together', () => {
		const markup = reorderGridColumns(`<grid widths="1,2,3">${CHART_ONE}${CHART_TWO}${CHART_THREE}</grid>`, 0, 2);
		const { columns, widths } = splitGridColumnsRaw(markup);

		expect(columns).toEqual([CHART_TWO, CHART_THREE, CHART_ONE]);
		expect(widths).toEqual([2, 3, 1]);
		expect(splitCodeIntoSegments(markup)[0]).toMatchObject({
			type: 'grid',
			widths: [2, 3, 1],
			children: [
				{ type: 'chart', chart: { title: 'Orders' } },
				{ type: 'chart', chart: { title: 'Profit' } },
				{ type: 'chart', chart: { title: 'Revenue' } },
			],
		});
	});

	it('returns the original markup for invalid moves and single columns', () => {
		const grid = `<grid widths="1,2">${CHART_ONE}${CHART_TWO}</grid>`;
		const singleColumn = `<grid>${CHART_ONE}</grid>`;

		expect(reorderGridColumns(grid, -1, 1)).toBe(grid);
		expect(reorderGridColumns(grid, 0, 2)).toBe(grid);
		expect(reorderGridColumns(singleColumn, 0, 0)).toBe(singleColumn);
	});
});

describe('popGridColumn', () => {
	it('pops a column and keeps the remaining relative widths', () => {
		const grid = `<grid widths="1,1,2">\n${CHART_ONE}\n\n${CHART_TWO}\n\n${CHART_THREE}\n</grid>`;
		const result = popGridColumn(grid, 2);

		expect(result).toEqual({
			popped: CHART_THREE,
			remaining: `<grid widths="1,1">\n${CHART_ONE}\n\n${CHART_TWO}\n</grid>`,
		});

		const segments = splitCodeIntoSegments(`${result?.popped}\n\n${result?.remaining}`);
		expect(segments).toHaveLength(2);
		expect(segments[0]).toMatchObject({
			type: 'chart',
			chart: { title: 'Profit' },
		});
		expect(segments[1]).toMatchObject({
			type: 'grid',
			widths: [1, 1],
			children: [
				{ type: 'chart', chart: { title: 'Revenue' } },
				{ type: 'chart', chart: { title: 'Orders' } },
			],
		});
	});

	it('collapses a two-column grid to the remaining full-width block', () => {
		const grid = `<grid widths="3,1">\n${CHART_ONE}\n\n${CHART_TWO}\n</grid>`;

		expect(popGridColumn(grid, 0)).toEqual({
			popped: CHART_ONE,
			remaining: CHART_TWO,
		});
	});

	it('returns null for invalid columns and single-column grids', () => {
		const grid = `<grid widths="1,1">${CHART_ONE}${CHART_TWO}</grid>`;
		const singleColumn = `<grid widths="1">${CHART_ONE}</grid>`;

		expect(popGridColumn(grid, -1)).toBeNull();
		expect(popGridColumn(grid, 2)).toBeNull();
		expect(popGridColumn(singleColumn, 0)).toBeNull();
	});
});

describe('popGridColumns', () => {
	it('removes one column and keeps the remaining columns in a grid', () => {
		const grid = `<grid widths="1,1,2">\n${CHART_ONE}\n\n${CHART_TWO}\n\n${CHART_THREE}\n</grid>`;
		const result = popGridColumns(grid, [2]);

		expect(result?.popped).toBe(CHART_THREE);
		expect(splitGridColumnsRaw(result?.remaining ?? '').columns).toEqual([CHART_ONE, CHART_TWO]);
	});

	it('removes multiple columns into a grid and leaves one column', () => {
		const grid = `<grid widths="1,1,2">\n${CHART_ONE}\n\n${CHART_TWO}\n\n${CHART_THREE}\n</grid>`;
		const result = popGridColumns(grid, [0, 2]);

		expect(result?.remaining).toBe(CHART_TWO);
		expect(splitGridColumnsRaw(result?.popped ?? '').columns).toEqual([CHART_ONE, CHART_THREE]);
	});

	it('removes all columns into a grid', () => {
		const grid = `<grid widths="1,1,2">\n${CHART_ONE}\n\n${CHART_TWO}\n\n${CHART_THREE}\n</grid>`;
		const result = popGridColumns(grid, [0, 1, 2]);

		expect(result?.remaining).toBeNull();
		expect(splitGridColumnsRaw(result?.popped ?? '').columns).toEqual([CHART_ONE, CHART_TWO, CHART_THREE]);
	});

	it('normalizes out-of-order and duplicate indices', () => {
		const grid = `<grid widths="1,1,2">\n${CHART_ONE}\n\n${CHART_TWO}\n\n${CHART_THREE}\n</grid>`;

		expect(popGridColumns(grid, [2, 0, 0])).toEqual(popGridColumns(grid, [0, 2]));
	});

	it('returns null for invalid input', () => {
		const grid = `<grid widths="1,1,2">\n${CHART_ONE}\n\n${CHART_TWO}\n\n${CHART_THREE}\n</grid>`;

		expect(popGridColumns(grid, [])).toBeNull();
		expect(popGridColumns(grid, [3])).toBeNull();
		expect(popGridColumns(CHART_ONE, [0])).toBeNull();
	});
});

describe('splitCodeIntoSegments grid widths', () => {
	it('converts legacy span divs into grid widths without empty columns', () => {
		const segments = splitCodeIntoSegments(
			`<grid cols="3">${CHART_ONE}<div style="grid-column: span 2;">${CHART_TWO}</div></grid>`,
		);
		const grid = segments[0];

		expect(grid).toMatchObject({
			type: 'grid',
			cols: 3,
			widths: [1, 2],
			children: [
				{ type: 'chart', chart: { chartType: 'line', title: 'Revenue' } },
				{ type: 'chart', chart: { chartType: 'bar', title: 'Orders' } },
			],
		});
		if (grid.type !== 'grid') {
			throw new Error('Expected a grid segment');
		}
		expect(grid.children).toHaveLength(2);
		expect(
			grid.children.some(
				(child) =>
					child.type === 'markdown' && (child.content.includes('<div') || child.content.includes('</div>')),
			),
		).toBe(false);
	});

	it('includes valid resolved widths', () => {
		const segments = splitCodeIntoSegments(`<grid widths="3,1">${CHART_ONE}${CHART_TWO}</grid>`);

		expect(segments).toHaveLength(1);
		expect(segments[0]).toMatchObject({
			type: 'grid',
			widths: [3, 1],
			children: [{ type: 'chart' }, { type: 'chart' }],
		});
	});

	it('leaves widths null for legacy grids', () => {
		const segments = splitCodeIntoSegments(`<grid cols="2">${CHART_ONE}${CHART_TWO}</grid>`);

		expect(segments[0]).toMatchObject({
			type: 'grid',
			cols: 2,
			widths: null,
			children: [{ type: 'chart' }, { type: 'chart' }],
		});
	});

	it('uses explicit widths instead of legacy spans', () => {
		const segments = splitCodeIntoSegments(
			`<grid cols="2" widths="3,1">${CHART_ONE}<div style="grid-column: span 2;">${CHART_TWO}</div></grid>`,
		);

		expect(segments[0]).toMatchObject({
			type: 'grid',
			widths: [3, 1],
			children: [{ type: 'chart' }, { type: 'chart' }],
		});
	});

	it('leaves widths null for invalid explicit widths', () => {
		const segments = splitCodeIntoSegments(`<grid widths="3">${CHART_ONE}${CHART_TWO}</grid>`);

		expect(segments[0]).toMatchObject({
			type: 'grid',
			widths: null,
		});
	});
});

function chartOf(code: string) {
	const segment = splitCodeIntoSegments(code).find((s) => s.type === 'chart');
	return segment?.type === 'chart' ? segment.chart : null;
}

function seriesOf(code: string) {
	return chartOf(code)?.series ?? null;
}

describe('splitCodeIntoSegments chart series', () => {
	it('round-trips a label containing a backslash built via buildStoryChartBlock', () => {
		const code = buildStoryChartBlock({
			query_id: 'q1',
			chart_type: 'bar',
			x_axis_key: 'month',
			x_axis_type: null,
			series: [{ data_key: 'rev', color: 'var(--chart-1)', label: 'Disc\\Rebate' }],
			title: 'Revenue',
		});

		expect(seriesOf(code)).toEqual([{ data_key: 'rev', color: 'var(--chart-1)', label: 'Disc\\Rebate' }]);
	});

	it('recovers a hand-authored series where a backslash was not JSON-escaped', () => {
		const code =
			'<chart query_id="q1" chart_type="bar" x_axis_key="month" series=\'[{"data_key":"rev","label":"Disc\\Rebate"}]\' />';

		expect(seriesOf(code)).toEqual([{ data_key: 'rev', label: 'Disc\\Rebate' }]);
	});

	it('recovers a hand-authored series with a malformed unicode escape', () => {
		const code =
			'<chart query_id="q1" chart_type="bar" x_axis_key="month" series=\'[{"data_key":"rev","label":"A\\uZZZZ"}]\' />';

		expect(seriesOf(code)).toEqual([{ data_key: 'rev', label: 'A\\uZZZZ' }]);
	});

	it('recovers a hand-authored series with a truncated unicode escape', () => {
		const code =
			'<chart query_id="q1" chart_type="bar" x_axis_key="month" series=\'[{"data_key":"rev","label":"A\\u00"}]\' />';

		expect(seriesOf(code)).toEqual([{ data_key: 'rev', label: 'A\\u00' }]);
	});

	it('preserves a well-formed unicode escape', () => {
		const code =
			'<chart query_id="q1" chart_type="bar" x_axis_key="month" series=\'[{"data_key":"rev","label":"A\\u0041"}]\' />';

		expect(seriesOf(code)).toEqual([{ data_key: 'rev', label: 'AA' }]);
	});

	it('round-trips a label containing a double quote', () => {
		const code = buildStoryChartBlock({
			query_id: 'q1',
			chart_type: 'bar',
			x_axis_key: 'month',
			x_axis_type: null,
			series: [{ data_key: 'rev', color: 'var(--chart-1)', label: 'a "quoted" label' }],
			title: 'Revenue',
		});

		expect(seriesOf(code)).toEqual([{ data_key: 'rev', color: 'var(--chart-1)', label: 'a "quoted" label' }]);
	});

	it('round-trips a series value format', () => {
		const code = buildStoryChartBlock({
			query_id: 'q1',
			chart_type: 'bar',
			x_axis_key: 'month',
			series: [
				{
					data_key: 'rev',
					color: 'var(--chart-1)',
					value_format: { d3_format: ',.2f', compact: 'financial', prefix: '$', suffix: ' USD' },
				},
			],
			title: 'Revenue',
		});

		expect(seriesOf(code)).toEqual([
			{
				data_key: 'rev',
				color: 'var(--chart-1)',
				value_format: { d3_format: ',.2f', compact: 'financial', prefix: '$', suffix: ' USD' },
			},
		]);
	});
});

describe('parseChartBlock x-axis requirements', () => {
	it('allows KPI cards without an x-axis key but rejects other chart types', () => {
		const kpiCard = parseChartBlock(
			'query_id="query_bd642c80" chart_type="kpi_card" title="Total Revenue ($)" series=\'[{"data_key":"total_revenue"}]\'',
		);

		expect(kpiCard).not.toBeNull();
		expect(kpiCard?.xAxisKey).toBe('');
		expect(kpiCard?.series).toEqual([{ data_key: 'total_revenue' }]);
		expect(
			parseChartBlock('query_id="query_bd642c80" chart_type="bar" series=\'[{"data_key":"total_revenue"}]\''),
		).toBeNull();
	});
});

describe('KPI comparison mode story blocks', () => {
	it('round-trips a comparison mode', () => {
		const code = buildStoryChartBlock({
			query_id: 'q1',
			chart_type: 'kpi_card',
			x_axis_key: 'year',
			x_axis_type: 'date',
			series: [{ data_key: 'revenue' }],
			title: 'Revenue',
			comparison_mode: 'percentage',
		});

		expect(code).toContain('comparison_mode="percentage"');
		expect(chartOf(code)?.comparisonMode).toBe('percentage');
	});

	it('does not emit the none comparison mode', () => {
		const code = buildStoryChartBlock({
			query_id: 'q1',
			chart_type: 'kpi_card',
			x_axis_key: 'year',
			x_axis_type: 'date',
			series: [{ data_key: 'revenue' }],
			title: 'Revenue',
			comparison_mode: 'none',
		});

		expect(code).not.toContain('comparison_mode=');
	});
});

describe('splitCodeIntoSegments chart total visibility', () => {
	it('parses hide_total and defaults it to false when omitted', () => {
		const hidden =
			'<chart query_id="q1" chart_type="bar" x_axis_key="month" series=\'[{"data_key":"rev"}]\' hide_total="true" />';
		const visible = '<chart query_id="q1" chart_type="bar" x_axis_key="month" series=\'[{"data_key":"rev"}]\' />';

		expect(chartOf(hidden)?.hideTotal).toBe(true);
		expect(chartOf(visible)?.hideTotal).toBe(false);
	});

	it('round-trips hide_total through buildStoryChartBlock', () => {
		const code = buildStoryChartBlock({
			query_id: 'q1',
			chart_type: 'bar',
			x_axis_key: 'month',
			x_axis_type: null,
			series: [{ data_key: 'rev' }],
			title: 'Revenue',
			hide_total: true,
		});

		expect(code).toContain('hide_total="true"');
		expect(chartOf(code)?.hideTotal).toBe(true);
	});
});

describe('splitCodeIntoSegments slash-in-attribute handling', () => {
	it('parses a chart whose title contains a slash', () => {
		const code =
			'<chart query_id="query_8af4f8ab" chart_type="line" x_axis_key="week_start" x_axis_type="date" series=\'[{"data_key":"number_of_orders","color":"#2563eb","label":"Number of orders","is_total":false}]\' title="13/07 update" />';

		const chart = chartOf(code);
		expect(chart?.title).toBe('13/07 update');
		expect(chart?.series).toEqual([
			{ data_key: 'number_of_orders', color: '#2563eb', label: 'Number of orders', is_total: false },
		]);
	});

	it('parses a series label containing a slash', () => {
		const code = buildStoryChartBlock({
			query_id: 'q1',
			chart_type: 'bar',
			x_axis_key: 'month',
			x_axis_type: null,
			series: [{ data_key: 'rev', color: 'var(--chart-1)', label: 'rev/cost' }],
			title: 'Ratio',
		});

		expect(seriesOf(code)).toEqual([{ data_key: 'rev', color: 'var(--chart-1)', label: 'rev/cost' }]);
	});

	it('handles a slash in the title together with a backslash in a label', () => {
		const code = buildStoryChartBlock({
			query_id: 'q1',
			chart_type: 'bar',
			x_axis_key: 'month',
			x_axis_type: null,
			series: [{ data_key: 'rev', color: 'var(--chart-1)', label: 'Disc\\Rebate' }],
			title: '13/07 update',
		});

		const chart = chartOf(code);
		expect(chart?.title).toBe('13/07 update');
		expect(chart?.series).toEqual([{ data_key: 'rev', color: 'var(--chart-1)', label: 'Disc\\Rebate' }]);
	});

	it('parses a chart whose title contains a greater-than sign', () => {
		const code =
			'<chart query_id="q1" chart_type="bar" x_axis_key="month" series=\'[{"data_key":"rev"}]\' title="rev > 100" />';

		const chart = chartOf(code);
		expect(chart?.title).toBe('rev > 100');
		expect(chart?.series).toEqual([{ data_key: 'rev' }]);
	});

	it('still parses a plain self-closing chart tag', () => {
		const code = '<chart query_id="q1" chart_type="bar" x_axis_key="month" data_key="rev" title="Revenue" />';

		const chart = chartOf(code);
		expect(chart?.title).toBe('Revenue');
		expect(chart?.series).toEqual([{ data_key: 'rev', color: 'var(--chart-1)', label: undefined }]);
	});
});

describe('story filter tags', () => {
	it('parses filter tags from code and as segments', () => {
		const code = [
			buildStoryFilterBlock({
				id: 'country',
				column: 'country',
				label: 'Country',
				type: 'multi_select',
				table: 'orders',
			}),
			'<chart query_id="q1" chart_type="bar" x_axis_key="month" data_key="rev" title="Revenue" />',
		].join('\n');

		expect(getStoryFiltersFromCode(code)).toEqual([
			{
				id: 'country',
				column: 'country',
				label: 'Country',
				filterType: 'multi_select',
				table: 'orders',
				rawTag: expect.any(String),
			},
		]);
		expect(splitCodeIntoSegments(code).some((segment) => segment.type === 'filter')).toBe(true);
	});

	it('parses hardcoded options without table/column', () => {
		const code = buildStoryFilterBlock({
			id: 'country',
			label: 'Country',
			type: 'select',
			options: ['US', 'FR'],
		});

		expect(getStoryFiltersFromCode(code)).toEqual([
			{
				id: 'country',
				label: 'Country',
				filterType: 'select',
				options: ['US', 'FR'],
				rawTag: expect.any(String),
			},
		]);
	});

	it('parses database_id for table-backed filters', () => {
		const code = buildStoryFilterBlock({
			id: 'product',
			column: 'product_name',
			label: 'Product',
			type: 'select',
			table: '`nao-production`.`prod_silver`.`dim_products`',
			database_id: 'bigquery',
		});

		expect(getStoryFiltersFromCode(code)).toEqual([
			{
				id: 'product',
				column: 'product_name',
				label: 'Product',
				filterType: 'select',
				table: '`nao-production`.`prod_silver`.`dim_products`',
				databaseId: 'bigquery',
				rawTag: expect.any(String),
			},
		]);
	});
});

describe('buildStoryMapBlock', () => {
	it('emits a basic points block', () => {
		const tag = buildStoryMapBlock({
			query_id: 'q1',
			map_type: 'points',
			latitude_key: 'lat',
			longitude_key: 'lng',
			title: 'City Points',
		});
		expect(tag).toContain('query_id="q1"');
		expect(tag).toContain('map_type="points"');
		expect(tag).toContain('latitude_key="lat"');
		expect(tag).toContain('longitude_key="lng"');
		expect(tag).toContain('title="City Points"');
	});

	it('emits boundaries_url and boundaries_join_property for choropleth with URL', () => {
		const tag = buildStoryMapBlock({
			query_id: 'q2',
			map_type: 'choropleth',
			value_key: 'sales',
			region_key: 'state',
			boundaries_url: 'https://example.com/states.geojson',
			boundaries_join_property: 'name',
			title: 'Sales by State',
		});
		expect(tag).toContain('boundaries_url="https://example.com/states.geojson"');
		expect(tag).toContain('boundaries_join_property="name"');
		expect(tag).not.toContain('latitude_key');
	});

	it('round-trips through parseMapBlock with boundaries_url', () => {
		const tag = buildStoryMapBlock({
			query_id: 'q3',
			map_type: 'choropleth',
			value_key: 'pop',
			region_key: 'iso',
			boundaries_url: 'https://cdn.example.com/world.geojson',
			boundaries_join_property: 'ISO_A3',
			title: 'World Map',
		});
		const parsed = parseMapBlock(tag.slice('<map '.length, -3));
		expect(parsed?.boundariesUrl).toBe('https://cdn.example.com/world.geojson');
		expect(parsed?.boundariesJoinProperty).toBe('ISO_A3');
	});
});

describe('mapBlockToInput', () => {
	it('maps a choropleth block with region_boundaries', () => {
		const map = parseMapBlock(
			'query_id="q1" map_type="choropleth" value_key="sales" region_key="country" region_boundaries="world_countries" title="Sales"',
		);
		expect(mapBlockToInput(map!)).toMatchObject({
			query_id: 'q1',
			map_type: 'choropleth',
			value_key: 'sales',
			region_key: 'country',
			region_boundaries: 'world_countries',
		});
	});

	it('maps a choropleth block with boundaries_url and boundaries_join_property', () => {
		const map = parseMapBlock(
			'query_id="q1" map_type="choropleth" value_key="sales" region_key="state" boundaries_url="https://example.com/states.geojson" boundaries_join_property="name" title="Sales"',
		);
		expect(mapBlockToInput(map!)).toMatchObject({
			boundaries_url: 'https://example.com/states.geojson',
			boundaries_join_property: 'name',
			region_key: 'state',
		});
	});

	it('defaults the map type to points', () => {
		const map = parseMapBlock('query_id="q1" latitude_key="lat" longitude_key="lng" title="Points"');
		expect(mapBlockToInput(map!).map_type).toBe('points');
	});
});
