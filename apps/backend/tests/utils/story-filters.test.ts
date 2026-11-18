import { renderSqlTemplate, stripSqlFilterBlocks } from '@nao/shared/sql-template';
import { describe, expect, it } from 'vitest';

import { toSafeSqlIdentifier } from '../../src/utils/sql-identifiers';

describe('story filter SQL templates', () => {
	it('strips filter blocks for chat / live baseline execution', () => {
		const sql = `
SELECT SUM(revenue) AS revenue
FROM orders
WHERE 1 = 1
{% filter country %} AND country IN ({{ filters.country.sql }}) {% endfilter %}
`.trim();

		expect(stripSqlFilterBlocks(sql)).toContain('WHERE 1 = 1');
		expect(stripSqlFilterBlocks(sql)).not.toContain('{% filter');
		expect(stripSqlFilterBlocks(sql)).not.toContain('country IN');
	});

	it('renders active filter selections into executable SQL', () => {
		const sql = `
SELECT SUM(revenue) AS revenue
FROM orders
WHERE 1 = 1
{% filter country %} AND country IN ({{ filters.country.sql }}) {% endfilter %}
`.trim();

		expect(renderSqlTemplate(sql, { country: ['US', 'FR'] }, { country: { type: 'multi_select' } })).toContain(
			"AND country IN ('US', 'FR')",
		);
	});
});

describe('toSafeSqlIdentifier', () => {
	it('accepts dotted and quoted identifiers', () => {
		expect(toSafeSqlIdentifier('orders', 'table')).toBe('orders');
		expect(toSafeSqlIdentifier('public.orders', 'table')).toBe('public.orders');
		expect(toSafeSqlIdentifier('"Order Status"', 'column')).toBe('"Order Status"');
		expect(toSafeSqlIdentifier('`nao-production`.`prod_silver`.`dim_products`', 'table')).toBe(
			'`nao-production`.`prod_silver`.`dim_products`',
		);
	});

	it('rejects unsafe identifiers', () => {
		expect(() => toSafeSqlIdentifier('orders; DROP TABLE x', 'table')).toThrow(/Invalid filter table/);
		expect(() => toSafeSqlIdentifier('col-name', 'column')).toThrow(/Invalid filter column/);
		expect(() => toSafeSqlIdentifier('nao--production.prod_silver.dim_products', 'table')).toThrow(
			/Invalid filter table/,
		);
		expect(() => toSafeSqlIdentifier('orders.', 'table')).toThrow(/Invalid filter table/);
	});

	it('accepts mixed quoting across parts', () => {
		expect(toSafeSqlIdentifier('`nao-production`.prod_silver.dim_products', 'table')).toBe(
			'`nao-production`.prod_silver.dim_products',
		);
		expect(toSafeSqlIdentifier('`nao-production.prod_silver.dim_products`', 'table')).toBe(
			'`nao-production.prod_silver.dim_products`',
		);
		expect(toSafeSqlIdentifier('analytics."Order Lines"', 'table')).toBe('analytics."Order Lines"');
	});

	it('backtick-quotes unquoted hyphenated table parts', () => {
		expect(toSafeSqlIdentifier('nao-production.prod_silver.dim_products', 'table')).toBe(
			'`nao-production`.prod_silver.dim_products',
		);
	});
});
