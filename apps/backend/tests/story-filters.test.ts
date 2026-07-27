import { renderSqlTemplate, stripSqlFilterBlocks } from '@nao/shared/sql-template';
import { describe, expect, it } from 'vitest';

import { assertSafeSqlIdentifier } from '../src/utils/sql-identifiers';

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

		expect(renderSqlTemplate(sql, { country: ['US', 'FR'] }, { country: 'multi_select' })).toContain(
			"AND country IN ('US', 'FR')",
		);
	});
});

describe('assertSafeSqlIdentifier', () => {
	it('accepts dotted and quoted identifiers', () => {
		expect(assertSafeSqlIdentifier('orders', 'table')).toBe('orders');
		expect(assertSafeSqlIdentifier('public.orders', 'table')).toBe('public.orders');
		expect(assertSafeSqlIdentifier('"Order Status"', 'column')).toBe('"Order Status"');
		expect(assertSafeSqlIdentifier('`nao-production`.`prod_silver`.`dim_products`', 'table')).toBe(
			'`nao-production`.`prod_silver`.`dim_products`',
		);
	});

	it('rejects unsafe identifiers', () => {
		expect(() => assertSafeSqlIdentifier('orders; DROP TABLE x', 'table')).toThrow(/Invalid filter table/);
		expect(() => assertSafeSqlIdentifier('col-name', 'column')).toThrow(/Invalid filter column/);
		expect(() => assertSafeSqlIdentifier('nao-production.prod_silver.dim_products', 'table')).toThrow(
			/Invalid filter table/,
		);
	});
});
