import { renderSqlTemplate, stripSqlFilterBlocks } from '@nao/shared/sql-template';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createStoryExecutionContext: vi.fn(),
	executeLiveQuery: vi.fn(),
	executeRawSql: vi.fn(),
	getLatestVersionByChatAndSlug: vi.fn(),
	getSqlQueriesFromCode: vi.fn(),
	hasRowSecurity: vi.fn(),
}));

vi.mock('../src/queries/story.queries', () => ({
	getLatestVersionByChatAndSlug: mocks.getLatestVersionByChatAndSlug,
	getSqlQueriesFromCode: mocks.getSqlQueriesFromCode,
}));

vi.mock('../src/services/live-story', () => ({
	createStoryExecutionContext: mocks.createStoryExecutionContext,
	executeLiveQuery: mocks.executeLiveQuery,
	executeRawSql: mocks.executeRawSql,
	executeStoryQueries: vi.fn(),
	hasRowSecurity: mocks.hasRowSecurity,
}));

import { getStoryFilterOptions } from '../src/services/story-filters';
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

describe('getStoryFilterOptions', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_customers: { databaseId: 'warehouse-1' },
		});
		mocks.createStoryExecutionContext.mockResolvedValue({ toolContext: { projectId: 'project-1' } });
	});

	it('loads and normalizes options from a viewer-executed options query', async () => {
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			code: '<filter id="customer" type="select" options_query_id="query_customer_options" />',
		});
		mocks.hasRowSecurity.mockResolvedValue(true);
		mocks.executeLiveQuery.mockResolvedValue({
			columns: ['value'],
			data: [{ value: 'Charlie' }, { value: null }, { value: 'Alice' }, { value: 'Charlie' }],
		});

		await expect(
			getStoryFilterOptions('chat-1', 'customers', 'customer', {
				billingAccessVerifiedProjectId: 'project-1',
				viewerUserId: 'viewer-1',
			}),
		).resolves.toEqual({ options: ['Alice', 'Charlie'] });

		expect(mocks.executeLiveQuery).toHaveBeenCalledWith('chat-1', 'query_customer_options', {
			viewerUserId: 'viewer-1',
			billingAccessVerifiedProjectId: 'project-1',
		});
	});

	it('limits options-query values after sorting and deduplication', async () => {
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			code: '<filter id="customer" type="select" options_query_id="query_customer_options" />',
		});
		mocks.executeLiveQuery.mockResolvedValue({
			columns: ['value'],
			data: Array.from({ length: 101 }, (_, index) => ({ value: `Customer ${String(index).padStart(3, '0')}` })),
		});

		const result = await getStoryFilterOptions('chat-1', 'customers', 'customer');

		expect(result.options).toHaveLength(100);
		expect(result.options.at(0)).toBe('Customer 000');
		expect(result.options.at(-1)).toBe('Customer 099');
	});

	it('rejects an options query without a value column', async () => {
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			code: '<filter id="customer" type="select" options_query_id="query_customer_options" />',
		});
		mocks.executeLiveQuery.mockResolvedValue({
			columns: ['customer'],
			data: [{ customer: 'Alice' }],
		});

		await expect(getStoryFilterOptions('chat-1', 'customers', 'customer')).rejects.toThrow(
			'must return a column named "value"',
		);
	});

	it('does not fall back to hardcoded options when an options query fails', async () => {
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			code: `<filter id="customer" type="select" options_query_id="query_customer_options" options='["Owner only"]' />`,
		});
		mocks.hasRowSecurity.mockResolvedValue(true);
		mocks.executeLiveQuery.mockRejectedValue(new Error('options query failed'));

		await expect(
			getStoryFilterOptions('chat-1', 'customers', 'customer', {
				viewerUserId: 'viewer-1',
			}),
		).rejects.toThrow('options query failed');

		expect(mocks.executeRawSql).not.toHaveBeenCalled();
	});

	it('intersects hardcoded options with values visible through viewer row security', async () => {
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			code: `<filter id="customer" type="select" table="customers" column="name" options='["Alice","Bob","Charlie"]' />`,
		});
		mocks.hasRowSecurity.mockResolvedValue(true);
		mocks.executeRawSql.mockResolvedValue({
			columns: ['value'],
			data: [{ value: 'Bob' }, { value: 'Not configured' }],
		});

		await expect(
			getStoryFilterOptions('chat-1', 'customers', 'customer', {
				billingAccessVerifiedProjectId: 'project-1',
				viewerUserId: 'viewer-1',
			}),
		).resolves.toEqual({ options: ['Bob'] });

		expect(mocks.createStoryExecutionContext).toHaveBeenCalledWith('chat-1', 'viewer-1');
		expect(mocks.executeRawSql).toHaveBeenCalledWith(
			'SELECT DISTINCT name AS value FROM customers WHERE name IS NOT NULL ORDER BY name LIMIT 100',
			expect.objectContaining({
				databaseId: 'warehouse-1',
				billingAccessVerifiedProjectId: 'project-1',
			}),
		);
	});

	it('keeps hardcoded options without querying when viewer row security is not active', async () => {
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			code: `<filter id="customer" type="select" options='["Alice","Bob"]' />`,
		});
		mocks.hasRowSecurity.mockResolvedValue(false);

		await expect(
			getStoryFilterOptions('chat-1', 'customers', 'customer', {
				viewerUserId: 'viewer-1',
			}),
		).resolves.toEqual({ options: ['Alice', 'Bob'] });

		expect(mocks.createStoryExecutionContext).toHaveBeenCalledWith('chat-1', undefined);
		expect(mocks.executeRawSql).not.toHaveBeenCalled();
	});

	it('returns no hardcoded options to an RLS viewer when no dynamic source exists', async () => {
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			code: `<filter id="customer" type="select" options='["Alice","Bob"]' />`,
		});
		mocks.hasRowSecurity.mockResolvedValue(true);

		await expect(
			getStoryFilterOptions('chat-1', 'customers', 'customer', {
				viewerUserId: 'viewer-1',
			}),
		).resolves.toEqual({ options: [] });

		expect(mocks.executeRawSql).not.toHaveBeenCalled();
	});
});
