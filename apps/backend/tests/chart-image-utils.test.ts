import { describe, expect, it } from 'vitest';

import { selectLatestDisplayChartTableFormats } from '../src/queries/chart-image.utils';

describe('selectLatestDisplayChartTableFormats', () => {
	it('keeps the latest formatting per query_id (rows ordered oldest to newest)', () => {
		const rows = [
			{ toolInput: { query_id: 'q1', chart_type: 'table', conditional_formats: { a: { type: 'color-scale' } } } },
			{
				toolInput: {
					query_id: 'q1',
					chart_type: 'table',
					conditional_formats: { a: { type: 'threshold', operator: '>=', value: 1, color: 'red' } },
				},
			},
		];
		expect(selectLatestDisplayChartTableFormats(rows)).toEqual({
			q1: { a: { type: 'threshold', operator: '>=', value: 1, color: 'red' } },
		});
	});

	it('keeps entries from different query_ids independently', () => {
		const rows = [
			{ toolInput: { query_id: 'q1', chart_type: 'table', conditional_formats: { a: { type: 'color-scale' } } } },
			{
				toolInput: {
					query_id: 'q2',
					chart_type: 'table',
					conditional_formats: { b: { type: 'color-scale', color: '#ff0000' } },
				},
			},
		];
		expect(selectLatestDisplayChartTableFormats(rows)).toEqual({
			q1: { a: { type: 'color-scale' } },
			q2: { b: { type: 'color-scale', color: '#ff0000' } },
		});
	});

	it('skips malformed inputs, chart inputs, and empty formatting maps', () => {
		const rows = [
			{ toolInput: null },
			{ toolInput: { query_id: 'q1', chart_type: 'table' } },
			{ toolInput: { query_id: 'q1', chart_type: 'table', conditional_formats: {} } },
			{
				toolInput: {
					query_id: 'qChart',
					chart_type: 'bar',
					x_axis_key: 'month',
					x_axis_type: 'category',
					series: [{ data_key: 'revenue' }],
					title: 'Revenue',
				},
			},
			{ toolInput: { query_id: 'q2', chart_type: 'table', conditional_formats: { a: { type: 'color-scale' } } } },
		];
		expect(selectLatestDisplayChartTableFormats(rows)).toEqual({
			q2: { a: { type: 'color-scale' } },
		});
	});
});
