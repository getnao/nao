import { describe, expect, it } from 'vitest';
import { getStoryParametersFromCode, resolveStoryParameters, splitCodeIntoSegments } from '@nao/shared/story-segments';

import { stabilizeStorySegments } from './story-segment-stability';

describe('stabilizeStorySegments', () => {
	it('reuses unchanged chart, table, and map blocks', () => {
		const code = [
			'<chart query_id="chart-query" chart_type="line" x_axis_key="month" />',
			'<table query_id="table-query" />',
			'<map query_id="map-query" latitude_key="latitude" longitude_key="longitude" />',
		].join('\n');
		const first = stabilizeStorySegments(splitCodeIntoSegments(code), []);
		const second = stabilizeStorySegments(splitCodeIntoSegments(code), first);

		if (
			first[0]?.type !== 'chart' ||
			first[1]?.type !== 'table' ||
			first[2]?.type !== 'map' ||
			second[0]?.type !== 'chart' ||
			second[1]?.type !== 'table' ||
			second[2]?.type !== 'map'
		) {
			throw new Error('Expected chart, table, and map segments');
		}

		expect(second[0].chart).toBe(first[0].chart);
		expect(second[1].table).toBe(first[1].table);
		expect(second[2].map).toBe(first[2].map);
	});

	it('keeps a changed block as a new object', () => {
		const first = stabilizeStorySegments(
			splitCodeIntoSegments('<chart query_id="query" chart_type="line" x_axis_key="month" />'),
			[],
		);
		const second = stabilizeStorySegments(
			splitCodeIntoSegments('<chart query_id="query" chart_type="bar" x_axis_key="month" />'),
			first,
		);

		if (first[0]?.type !== 'chart' || second[0]?.type !== 'chart') {
			throw new Error('Expected chart segments');
		}

		expect(second[0].chart).not.toBe(first[0].chart);
	});

	it('refreshes a block whose raw tag is unchanged when a story parameter switches', () => {
		const code = [
			`<parameter id="metric" options='["revenue","orders"]' />`,
			'<chart query_id="query" chart_type="line" x_axis_key="month" series=\'[{"data_key":"{{ params.metric }}"}]\' />',
		].join('\n');
		const parameters = getStoryParametersFromCode(code);
		const first = stabilizeStorySegments(splitCodeIntoSegments(code, resolveStoryParameters(parameters)), []);
		const second = stabilizeStorySegments(
			splitCodeIntoSegments(code, resolveStoryParameters(parameters, { metric: 'orders' })),
			first,
		);

		if (first[0]?.type !== 'chart' || second[0]?.type !== 'chart') {
			throw new Error('Expected chart segments');
		}

		expect(second[0].chart.rawTag).toBe(first[0].chart.rawTag);
		expect(second[0].chart.series[0]?.data_key).toBe('orders');
	});

	it('reuses unchanged blocks nested in grids', () => {
		const code = `<grid cols="2">
<chart query_id="chart-query" chart_type="bar" x_axis_key="category" />
<table query_id="table-query" />
</grid>`;
		const first = stabilizeStorySegments(splitCodeIntoSegments(code), []);
		const second = stabilizeStorySegments(splitCodeIntoSegments(code), first);

		if (first[0]?.type !== 'grid' || second[0]?.type !== 'grid') {
			throw new Error('Expected grid segments');
		}
		const firstChart = first[0].children[0];
		const firstTable = first[0].children[1];
		const secondChart = second[0].children[0];
		const secondTable = second[0].children[1];
		if (
			firstChart?.type !== 'chart' ||
			firstTable?.type !== 'table' ||
			secondChart?.type !== 'chart' ||
			secondTable?.type !== 'table'
		) {
			throw new Error('Expected nested chart and table segments');
		}

		expect(secondChart.chart).toBe(firstChart.chart);
		expect(secondTable.table).toBe(firstTable.table);
	});
});
