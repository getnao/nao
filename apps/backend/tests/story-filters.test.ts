import { renderSqlTemplate, stripSqlFilterBlocks } from '@nao/shared/sql-template';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createStoryExecutionContext: vi.fn(),
	executeStoryQueries: vi.fn(),
	getLatestVersionByChatAndSlug: vi.fn(),
	getSqlQueriesFromCode: vi.fn(),
	hasRowSecurity: vi.fn(),
}));

vi.mock('../src/queries/story.queries', () => ({
	getLatestVersionByChatAndSlug: mocks.getLatestVersionByChatAndSlug,
	getSqlQueriesFromCode: mocks.getSqlQueriesFromCode,
}));

vi.mock('../src/services/live-story', () => ({
	availableStoryQueryData: (queryData: unknown) => queryData,
	createStoryExecutionContext: mocks.createStoryExecutionContext,
	executeStoryQueries: mocks.executeStoryQueries,
	requiresViewerStoryData: mocks.hasRowSecurity,
}));

import { getFilteredStoryQueryData } from '../src/services/story-filters';
import { toSafeSqlIdentifier } from '../src/utils/sql-identifiers';

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

describe('getFilteredStoryQueryData', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			code: '<filter id="country" type="select" table="orders" column="country" />',
		});
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_orders: { sqlQuery: 'SELECT * FROM orders', adminMode: false },
		});
		mocks.createStoryExecutionContext.mockResolvedValue({ toolContext: { userId: 'viewer-1' } });
		mocks.executeStoryQueries.mockResolvedValue({});
	});

	it('executes filtered queries with the viewer context when row security is enabled', async () => {
		mocks.hasRowSecurity.mockResolvedValue(true);

		await getFilteredStoryQueryData(
			'chat-1',
			'story',
			{ country: 'US' },
			{ billingAccessVerifiedProjectId: 'project-1', viewerUserId: 'viewer-1' },
		);

		expect(mocks.createStoryExecutionContext).toHaveBeenCalledWith('chat-1', 'viewer-1');
		expect(mocks.executeStoryQueries).toHaveBeenCalledWith(
			'chat-1',
			expect.anything(),
			expect.objectContaining({
				executionContext: { toolContext: { userId: 'viewer-1' } },
				billingAccessVerifiedProjectId: 'project-1',
			}),
		);
	});
});
