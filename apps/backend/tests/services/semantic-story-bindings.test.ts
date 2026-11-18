import { describe, expect, it, vi } from 'vitest';

import { bindSemanticQuery, semanticBindingsFromCode } from '../../src/services/semantic-story-bindings';

const CATALOG = {
	metrics: [
		{ name: 'revenue', label: 'Revenue', description: null, dimensions: ['customer__region', 'order__channel'] },
		{ name: 'unique_sales', label: 'Unique sales', description: null, dimensions: ['customer__region'] },
	],
	dimensions: [
		{ name: 'customer__region', type: 'categorical', granularity: null, description: null },
		{ name: 'customer__first_order', type: 'time', granularity: 'day', description: null },
	],
};

const CODE = [
	`<parameter id="metric" type="metric" options='["revenue","unique_sales"]' default="revenue" />`,
	`<parameter id="grain" options='["week","month"]' default="week" />`,
	'<filter id="region" type="multi_select" dimension="customer__region" />',
	'<filter id="channel" type="select" dimension="order__channel" />',
	'<filter id="period" type="date_range" dimension="metric_time" />',
	'<filter id="user" type="text" value_type="number" dimension="customer__id" />',
	'<filter id="country" type="select" table="orders" column="country" />',
].join('\n');

const QUERY = {
	metrics: ['{{ params.metric }}'],
	group_by: ['metric_time__{{ params.grain }}'],
	params: { metric: 'revenue', grain: 'week' },
};

describe('bindSemanticQuery', () => {
	it('applies parameter selections and only keeps dimension filters', async () => {
		const bindings = semanticBindingsFromCode(CODE, { metric: 'unique_sales', grain: 'month' });

		expect(bindings.parameterValues).toEqual({ metric: 'unique_sales', grain: 'month' });
		expect(bindings.dimensionFilters.map((filter) => filter.id)).toEqual(['region', 'channel', 'period', 'user']);

		const loadCatalog = vi.fn(async () => CATALOG);
		const bound = await bindSemanticQuery(QUERY, bindings, loadCatalog);
		expect(bound.query.params).toEqual({ metric: 'unique_sales', grain: 'month' });
		expect(bound.skippedFilterIds).toEqual([]);
		expect(loadCatalog).not.toHaveBeenCalled();
	});

	it('turns active dimension filters into where constraints and metric_time bounds', async () => {
		const bindings = semanticBindingsFromCode(CODE, {
			region: ['EMEA', "Côte d'Ivoire"],
			channel: 'Online',
			period: ['2026-01-01', '2026-03-31'],
			user: '42',
		});

		const bound = await bindSemanticQuery(QUERY, bindings, async () => CATALOG);

		expect(bound.query.where).toEqual([
			"{{ Dimension('customer__region') }} IN ('EMEA', 'Côte d''Ivoire')",
			"{{ Dimension('order__channel') }} = 'Online'",
		]);
		expect(bound.query).toMatchObject({ start_time: '2026-01-01', end_time: '2026-03-31' });
		expect(bound.skippedFilterIds).toEqual(['user']);
	});

	it('skips filters whose dimension the selected metric does not support', async () => {
		const bindings = semanticBindingsFromCode(CODE, { metric: 'unique_sales', channel: 'Online' });

		const bound = await bindSemanticQuery(QUERY, bindings, async () => CATALOG);

		expect(bound.query.where).toBeUndefined();
		expect(bound.skippedFilterIds).toEqual(['channel']);
	});

	it('applies filters when the catalog is unavailable and lets the layer report errors', async () => {
		const bindings = semanticBindingsFromCode(CODE, { channel: 'Online' });

		const bound = await bindSemanticQuery(QUERY, bindings, async () => null);

		expect(bound.query.where).toEqual(["{{ Dimension('order__channel') }} = 'Online'"]);
	});

	it('only applies date ranges to time dimensions', async () => {
		const code = [
			'<filter id="first_order" type="date_range" dimension="customer__first_order" />',
			'<filter id="region_range" type="date_range" dimension="customer__region" />',
		].join('\n');
		const bindings = semanticBindingsFromCode(code, {
			first_order: ['2018-01-01', '2018-01-31'],
			region_range: ['2018-01-01', '2018-01-31'],
		});
		const catalogWithDimensions = {
			...CATALOG,
			metrics: CATALOG.metrics.map((metric) => ({
				...metric,
				dimensions: [...metric.dimensions, 'customer__first_order'],
			})),
		};

		const bound = await bindSemanticQuery(QUERY, bindings, async () => catalogWithDimensions);

		expect(bound.query.where).toEqual([
			"{{ TimeDimension('customer__first_order', 'day') }} BETWEEN '2018-01-01' AND '2018-01-31'",
		]);
		expect(bound.skippedFilterIds).toEqual(['region_range']);
	});

	it('leaves the query untouched without bindings', async () => {
		expect(await bindSemanticQuery(QUERY, undefined, async () => CATALOG)).toEqual({
			query: QUERY,
			skippedFilterIds: [],
		});
	});
});
