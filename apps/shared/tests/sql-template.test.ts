import { describe, expect, it } from 'vitest';

import {
	extractSqlFilterIds,
	renderFilterSqlValue,
	renderSqlTemplate,
	stripSqlFilterBlocks,
} from '../src/sql-template';

const SAMPLE_SQL = `
SELECT SUM(revenue) AS revenue, country
FROM orders
WHERE 1 = 1
{% filter country %} AND country IN ({{ filters.country.sql }}) {% endfilter %}
{% filter q %} AND customer_name ILIKE {{ filters.q.sql }} {% endfilter %}
{% filter period %} AND order_date BETWEEN {{ filters.period.sql }} {% endfilter %}
GROUP BY country
`.trim();

describe('stripSqlFilterBlocks', () => {
	it('removes all filter blocks so SQL runs without story filters', () => {
		expect(stripSqlFilterBlocks(SAMPLE_SQL)).toBe(
			`
SELECT SUM(revenue) AS revenue, country
FROM orders
WHERE 1 = 1
GROUP BY country
`.trim(),
		);
	});
});

describe('extractSqlFilterIds', () => {
	it('returns unique filter ids in order of appearance', () => {
		expect(extractSqlFilterIds(SAMPLE_SQL)).toEqual(['country', 'q', 'period']);
	});
});

describe('renderFilterSqlValue', () => {
	it('renders select / multi_select / search / date_range fragments', () => {
		expect(renderFilterSqlValue('select', 'US')).toBe("'US'");
		expect(renderFilterSqlValue('multi_select', ['US', "O'Reilly"])).toBe("'US', 'O''Reilly'");
		expect(renderFilterSqlValue('search', 'acme%')).toBe("'%acme\\%%'");
		expect(renderFilterSqlValue('date_range', ['2024-01-01', '2024-12-31'])).toBe("'2024-01-01' AND '2024-12-31'");
	});

	it('returns null for inactive selections', () => {
		expect(renderFilterSqlValue('select', '')).toBeNull();
		expect(renderFilterSqlValue('multi_select', [])).toBeNull();
		expect(renderFilterSqlValue('date_range', ['2024-01-01', ''])).toBeNull();
	});
});

describe('renderSqlTemplate', () => {
	const types = {
		country: 'multi_select',
		q: 'search',
		period: 'date_range',
	} as const;

	it('keeps only active filter blocks and interpolates .sql placeholders', () => {
		const rendered = renderSqlTemplate(
			SAMPLE_SQL,
			{
				country: ['US', 'FR'],
				q: 'acme',
			},
			types,
		);

		expect(rendered).toContain("AND country IN ('US', 'FR')");
		expect(rendered).toContain("AND customer_name ILIKE '%acme%'");
		expect(rendered).not.toContain('order_date BETWEEN');
		expect(rendered).not.toContain('{% filter');
		expect(rendered).not.toContain('{{ filters');
	});

	it('strips all blocks when no selections are active', () => {
		expect(renderSqlTemplate(SAMPLE_SQL, {}, types)).toBe(stripSqlFilterBlocks(SAMPLE_SQL));
	});

	it('rejects unknown filter ids and misplaced placeholders', () => {
		expect(() => renderSqlTemplate(SAMPLE_SQL, { country: ['US'] }, {})).toThrow(/Unknown story filter/);
		expect(() =>
			renderSqlTemplate('SELECT 1 WHERE x = {{ filters.country.sql }}', { country: 'US' }, { country: 'select' }),
		).toThrow(/must appear inside/);
	});
});
