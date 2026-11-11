import { describe, expect, it } from 'vitest';

import { renderSqlTemplate } from '../src/sql-template';
import {
	hasStoryQueryInputs,
	serializeStoryQueryInputs,
	type StoryQueryFilters,
	toStoryFilterBindings,
	withInactiveFilterSpecs,
} from '../src/story-query-inputs';

const SQL = [
	'SELECT region, SUM(amount) AS revenue FROM orders WHERE 1 = 1',
	'{% filter region %} AND region = {{ filters.region.sql }} {% endfilter %}',
	'{% filter countries %} AND country IN ({{ filters.countries.sql }}) {% endfilter %}',
	'{% filter period %} AND order_date BETWEEN {{ filters.period.sql }} {% endfilter %}',
	'{% filter customer %} AND customer_name ILIKE {{ filters.customer.sql }} {% endfilter %}',
	'{% filter min_amount %} AND amount >= {{ filters.min_amount.sql }} {% endfilter %}',
	'GROUP BY region',
].join('\n');

function render(filters: StoryQueryFilters): string {
	const { selections, specs } = toStoryFilterBindings(filters);
	return renderSqlTemplate(SQL, selections, withInactiveFilterSpecs(SQL, specs)).replace(/\s+/g, ' ');
}

describe('toStoryFilterBindings', () => {
	it('renders each filter by the shape of its value', () => {
		const sql = render({
			region: 'EMEA',
			countries: ['FR', 'DE'],
			period: { from: '2024-01-01', to: '2024-03-31' },
			customer: { contains: 'acme' },
			min_amount: 100,
		});

		expect(sql).toContain("AND region = 'EMEA'");
		expect(sql).toContain("AND country IN ('FR', 'DE')");
		expect(sql).toContain("AND order_date BETWEEN '2024-01-01' AND '2024-03-31'");
		expect(sql).toContain("AND customer_name ILIKE '%acme%'");
		expect(sql).toContain('AND amount >= 100');
	});

	it('leaves out the blocks of filters that were not sent or are empty', () => {
		const sql = render({ region: 'EMEA', countries: [], customer: null });

		expect(sql).toContain("AND region = 'EMEA'");
		expect(sql).not.toContain('country IN');
		expect(sql).not.toContain('order_date');
		expect(sql).not.toContain('customer_name');
		expect(sql).not.toContain('amount >=');
	});

	it('quotes values so they cannot break out of the literal', () => {
		const sql = render({ region: "x' OR '1' = '1" });

		expect(sql).toContain("AND region = 'x'' OR ''1'' = ''1'");
	});

	it('ignores numbers that are not finite', () => {
		expect(toStoryFilterBindings({ min_amount: Number.NaN })).toEqual({ selections: {}, specs: {} });
	});
});

describe('serializeStoryQueryInputs', () => {
	it('is the same whatever order the filters were written in', () => {
		expect(serializeStoryQueryInputs({ filters: { a: '1', b: '2' } })).toBe(
			serializeStoryQueryInputs({ filters: { b: '2', a: '1' } }),
		);
	});

	it('is empty when nothing was chosen', () => {
		expect(serializeStoryQueryInputs({ filters: {}, params: {} })).toBe('');
		expect(hasStoryQueryInputs({ filters: {}, params: {} })).toBe(false);
	});
});
