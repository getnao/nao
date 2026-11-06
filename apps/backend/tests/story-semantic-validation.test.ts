import { describe, expect, it } from 'vitest';

import { getSemanticStoryWarnings } from '../src/services/story-semantic-validation';

const CATALOG = {
	metrics: [
		{ name: 'revenue', label: 'Revenue', description: null, dimensions: ['customer__region', 'order__channel'] },
		{ name: 'unique_sales', label: 'Unique sales', description: null, dimensions: ['customer__region'] },
	],
	dimensions: [],
};

const PARAMETERIZED_QUERY = {
	metrics: ['{{ params.metric }}'],
	group_by: ['metric_time__{{ params.grain }}'],
	params: { metric: 'revenue', grain: 'week' },
};

describe('getSemanticStoryWarnings', () => {
	it('accepts parameters and dimension filters that line up with the queries', async () => {
		const code = [
			`<parameter id="metric" type="metric" options='["revenue","unique_sales"]' />`,
			`<parameter id="grain" options='["week","month"]' />`,
			'<filter id="region" type="multi_select" dimension="customer__region" />',
			'## {{ params.metric.label }} by {{ params.grain }}',
		].join('\n');

		expect(
			await getSemanticStoryWarnings(code, { q1: PARAMETERIZED_QUERY }, { loadCatalog: async () => CATALOG }),
		).toEqual([]);
	});

	it('flags placeholders without a parameter tag and unused parameters', async () => {
		const code = [`<parameter id="metric" options='["revenue"]' />`, 'Showing {{ params.region }}'].join('\n');

		const warnings = await getSemanticStoryWarnings(code, {
			q1: PARAMETERIZED_QUERY,
			q2: { metrics: ['revenue'] },
		});

		expect(warnings).toEqual([
			expect.stringContaining('[q1] uses {{ params.grain }} but the story declares no <parameter id="grain"'),
			expect.stringContaining('Story text uses {{ params.region }}'),
		]);
	});

	it('flags parameters that no query uses', async () => {
		const warnings = await getSemanticStoryWarnings(`<parameter id="metric" options='["revenue"]' />`, {
			q1: { metrics: ['revenue'] },
		});

		expect(warnings).toEqual([expect.stringContaining('Story parameter "metric" is not used')]);
	});

	it('flags dimension filters in a story without semantic-layer charts', async () => {
		const warnings = await getSemanticStoryWarnings(
			'<filter id="region" type="select" dimension="customer__region" />',
			{},
		);

		expect(warnings).toEqual([expect.stringContaining('no chart uses a semantic-layer query')]);
	});

	it('does not flag dimension filters that SQL charts already use', async () => {
		const warnings = await getSemanticStoryWarnings(
			'<filter id="region" type="select" dimension="customer__region" table="orders" column="region" />',
			{},
			{ sqlFilterIds: new Set(['region']) },
		);

		expect(warnings).toEqual([]);
	});

	it('uses the catalog to flag unknown metric options and unsupported dimensions', async () => {
		const code = [
			`<parameter id="metric" type="metric" options='["revenue","unique_sales","margin"]' />`,
			`<parameter id="grain" options='["week"]' />`,
			'<filter id="channel" type="select" dimension="order__channel" />',
		].join('\n');

		const warnings = await getSemanticStoryWarnings(
			code,
			{ q1: PARAMETERIZED_QUERY },
			{ loadCatalog: async () => CATALOG },
		);

		expect(warnings).toEqual([
			expect.stringContaining('offers "margin", which is not a metric'),
			expect.stringContaining(
				'[q1] filter "channel" (order__channel) will not apply when the metric is unique_sales',
			),
		]);
	});
});
