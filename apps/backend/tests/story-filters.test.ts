import { renderSqlTemplate, stripSqlFilterBlocks } from '@nao/shared/sql-template';
import { describe, expect, it, vi } from 'vitest';

import { getFilteredStoryQueryData } from '../src/services/story-filters';
import { getStoryTemplateWarnings } from '../src/services/story-template-validation';
import { assertSafeSqlIdentifier } from '../src/utils/sql-identifiers';

const filterServiceMocks = vi.hoisted(() => ({
	executeRawSql: vi.fn(async (sqlQuery: string) => ({ columns: ['sql'], data: [{ sql: sqlQuery }] })),
}));

vi.mock('../src/queries/execute-sql.queries', () => ({
	getLatestSqlQueriesByIds: vi.fn(),
}));
vi.mock('../src/queries/chat.queries', () => ({
	getChatProjectId: vi.fn(async () => 'project-1'),
}));
vi.mock('../src/queries/project.queries', () => ({
	retrieveProjectById: vi.fn(async () => ({ path: '/tmp/project' })),
	getEnvVars: vi.fn(async () => ({})),
}));
vi.mock('../src/queries/story.queries', () => ({
	getLatestVersionByChatAndSlug: vi.fn(async () => ({
		code: [
			'<filter id="country" type="multi_select" options=\'["US","FR"]\' />',
			'<filter id="period" type="date_range" />',
		].join('\n'),
	})),
	getSqlQueriesFromCode: vi.fn(async () => ({
		query_country: {
			sqlQuery:
				'SELECT * FROM orders WHERE 1 = 1 {% filter country %} AND country IN ({{ filters.country.sql }}) {% endfilter %}',
		},
		query_period: {
			sqlQuery:
				'SELECT * FROM orders WHERE 1 = 1 {% filter period %} AND ordered_at BETWEEN {{ filters.period.sql }} {% endfilter %}',
		},
		query_static: { sqlQuery: 'SELECT * FROM orders' },
	})),
}));
vi.mock('../src/services/live-story', () => ({
	executeRawSql: filterServiceMocks.executeRawSql,
}));

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

	it('validates query definitions created in the current agent run', async () => {
		const filter = `<filter id="country" label="Country" type="multi_select" options='["US","FR"]' />`;
		const code = `
<tab title="Overview">
${filter}
<chart query_id="query_current" chart_type="bar" x_axis_key="country" series='[{"data_key":"revenue"}]' />
</tab>
<tab title="Details">
${filter}
</tab>
`.trim();
		const warnings = await getStoryTemplateWarnings('chat-not-persisted', code, {
			query_current: {
				sqlQuery:
					'SELECT country, SUM(revenue) AS revenue FROM orders WHERE 1 = 1 {% filter country %} AND country IN ({{ filters.country.sql }}) {% endfilter %} GROUP BY country',
			},
		});

		expect(warnings).toEqual([]);
	});

	it('executes only queries referenced by active filters', async () => {
		filterServiceMocks.executeRawSql.mockClear();

		const result = await getFilteredStoryQueryData('chat-1', 'story-1', { country: ['US'] });

		expect(filterServiceMocks.executeRawSql).toHaveBeenCalledOnce();
		expect(filterServiceMocks.executeRawSql.mock.calls[0][0]).toContain("country IN ('US')");
		expect(Object.keys(result)).toEqual(['query_country']);
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
