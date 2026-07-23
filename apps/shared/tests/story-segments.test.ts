import { describe, expect, it } from 'vitest';

import { buildStoryChartBlock, buildStoryFilterBlock } from '../src/chart-block';
import { getStoryFiltersFromCode, splitCodeIntoSegments } from '../src/story-segments';

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
			series: [{ data_key: 'rev', color: 'var(--chart-1)', label: 'a "quoted" label' }],
			title: 'Revenue',
		});

		expect(seriesOf(code)).toEqual([{ data_key: 'rev', color: 'var(--chart-1)', label: 'a "quoted" label' }]);
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
