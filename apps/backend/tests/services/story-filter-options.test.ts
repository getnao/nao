import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getStoryByChatAndSlug: vi.fn(),
	getLatestVersionByChatAndSlug: vi.fn(),
	getSqlQueriesFromCode: vi.fn(),
	getFilterOptionsCache: vi.fn(),
	upsertFilterOptionsCache: vi.fn(),
	deleteFilterOptionsCacheOlderThan: vi.fn(),
	createStoryExecutionContext: vi.fn(),
	executeStoryQueries: vi.fn(),
	executeRawSql: vi.fn(),
	hasRowSecurity: vi.fn(),
	compileSemanticQuery: vi.fn(),
	describeSemanticLayer: vi.fn(),
	resolveRawSqlDatabaseType: vi.fn(),
}));

vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/queries/story.queries', () => ({
	getStoryByChatAndSlug: mocks.getStoryByChatAndSlug,
	getLatestVersionByChatAndSlug: mocks.getLatestVersionByChatAndSlug,
	getSqlQueriesFromCode: mocks.getSqlQueriesFromCode,
}));
vi.mock('../../src/queries/story-filter-options-cache.queries', () => ({
	getFilterOptionsCache: mocks.getFilterOptionsCache,
	upsertFilterOptionsCache: mocks.upsertFilterOptionsCache,
	deleteFilterOptionsCacheOlderThan: mocks.deleteFilterOptionsCacheOlderThan,
}));
vi.mock('../../src/services/semantic-layer.service', () => ({
	compileSemanticQuery: mocks.compileSemanticQuery,
	describeSemanticLayerCached: mocks.describeSemanticLayer,
}));
vi.mock('../../src/services/live-story', () => ({
	createStoryExecutionContext: mocks.createStoryExecutionContext,
	executeStoryQueries: mocks.executeStoryQueries,
	executeRawSql: mocks.executeRawSql,
	requiresViewerStoryData: mocks.hasRowSecurity,
	resolveRawSqlDatabaseType: mocks.resolveRawSqlDatabaseType,
	isCacheExpired: () => false,
}));

import { getStoryFilterOptions, warmStoryFilterOptions } from '../../src/services/story-filter-options';

const STORY_CODE = [
	'<filter id="category" type="select" table="products" column="category" />',
	'<filter id="subcategory" type="multi_select" table="products" column="subcategory" depends_on="category" />',
	`<filter id="region" type="select" options='["EU","US"]' />`,
].join('\n');

describe('getStoryFilterOptions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getStoryByChatAndSlug.mockResolvedValue({ id: 'story-1', projectId: 'project-1', cacheSchedule: null });
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ code: STORY_CODE });
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			q1: { sqlQuery: 'SELECT 1', databaseId: 'warehouse', dialect: 'bigquery', adminMode: false },
		});
		mocks.createStoryExecutionContext.mockResolvedValue({ toolContext: { projectFolder: '/project' } });
		mocks.resolveRawSqlDatabaseType.mockResolvedValue('bigquery');
		mocks.executeRawSql.mockResolvedValue({ data: [{ value: 'Sports' }, { value: 'Home' }], columns: ['value'] });
		mocks.hasRowSecurity.mockResolvedValue(false);
	});

	it('queries the warehouse on a cache miss and stores the result', async () => {
		mocks.getFilterOptionsCache.mockResolvedValue(null);

		const result = await getStoryFilterOptions('chat-1', 'story', 'category');

		expect(result).toEqual({ options: ['Home', 'Sports'], isComplete: true });
		expect(mocks.executeRawSql.mock.calls[0][0]).toBe(
			'SELECT DISTINCT category AS value FROM products WHERE category IS NOT NULL ORDER BY category LIMIT 101',
		);
		expect(mocks.upsertFilterOptionsCache).toHaveBeenCalledWith(
			'story-1',
			expect.any(String),
			['Home', 'Sports'],
			true,
		);
	});

	it('serves fresh cached options without querying the warehouse', async () => {
		mocks.getFilterOptionsCache.mockResolvedValue({ options: ['Cached'], isComplete: true, cachedAt: new Date() });

		const result = await getStoryFilterOptions('chat-1', 'story', 'category');

		expect(result).toEqual({ options: ['Cached'], isComplete: true });
		expect(mocks.executeRawSql).not.toHaveBeenCalled();
	});

	it('serves stale cached options immediately and refreshes them in the background', async () => {
		const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
		mocks.getFilterOptionsCache.mockResolvedValue({ options: ['Stale'], isComplete: true, cachedAt: twoHoursAgo });

		const result = await getStoryFilterOptions('chat-1', 'story', 'category');

		expect(result).toEqual({ options: ['Stale'], isComplete: true });
		await vi.waitFor(() => expect(mocks.upsertFilterOptionsCache).toHaveBeenCalled());
	});

	it('narrows dependent filter options by the parent selection', async () => {
		mocks.getFilterOptionsCache.mockResolvedValue(null);

		await getStoryFilterOptions('chat-1', 'story', 'subcategory', { parentSelection: "Kid's" });

		expect(mocks.executeRawSql.mock.calls[0][0]).toContain(
			"WHERE subcategory IS NOT NULL AND category IN ('Kid''s')",
		);
	});

	it('searches truncated lists on the server without caching the result', async () => {
		await getStoryFilterOptions('chat-1', 'story', 'category', { search: ' Sp%o_ ' });

		expect(mocks.executeRawSql.mock.calls[0][0]).toContain("LOWER(CAST(category AS STRING)) LIKE '%sp%o_%'");
		expect(mocks.getFilterOptionsCache).not.toHaveBeenCalled();
		expect(mocks.upsertFilterOptionsCache).not.toHaveBeenCalled();
	});

	it('casts searches with the database type resolved by the warehouse executor', async () => {
		mocks.resolveRawSqlDatabaseType.mockResolvedValue('mssql');
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			code: '<filter id="company" type="multi_select" table="companies" column="name" database_id="warehouse" />',
		});

		await getStoryFilterOptions('chat-1', 'story', 'company', { search: 'fiver' });

		expect(mocks.resolveRawSqlDatabaseType).toHaveBeenCalledWith(expect.anything(), 'warehouse');
		expect(mocks.executeRawSql.mock.calls[0][0]).toContain("LOWER(CAST(name AS NVARCHAR(MAX))) LIKE '%fiver%'");
	});

	it('casts to VARCHAR for database types without a dedicated string type', async () => {
		mocks.resolveRawSqlDatabaseType.mockResolvedValue('duckdb');

		await getStoryFilterOptions('chat-1', 'story', 'category', { search: 'sport' });

		expect(mocks.executeRawSql.mock.calls[0][0]).toContain("LOWER(CAST(category AS VARCHAR)) LIKE '%sport%'");
	});

	it('searches a hyphenated BigQuery table narrowed by its parent filter', async () => {
		mocks.getSqlQueriesFromCode.mockResolvedValue({});
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			code: [
				'<filter id="deployment" type="multi_select" table="nao-production.prod_silver.kpis" column="deployment_type" database_id="nao-production" />',
				'<filter id="company" type="multi_select" table="nao-production.prod_silver.kpis" column="company_name" depends_on="deployment" database_id="nao-production" />',
			].join('\n'),
		});

		await getStoryFilterOptions('chat-1', 'story', 'company', { parentSelection: ['cloud'], search: 'my_co.io' });

		expect(mocks.executeRawSql.mock.calls[0][0]).toBe(
			"SELECT DISTINCT company_name AS value FROM `nao-production`.prod_silver.kpis WHERE company_name IS NOT NULL AND deployment_type IN ('cloud') AND LOWER(CAST(company_name AS STRING)) LIKE '%my_co.io%' ORDER BY company_name LIMIT 101",
		);
	});

	it('turns quotes and backslashes in searches into single-character wildcards', async () => {
		await getStoryFilterOptions('chat-1', 'story', 'category', { search: "Kid's \\toys" });

		expect(mocks.executeRawSql.mock.calls[0][0]).toContain("LIKE '%kid_s _toys%'");
	});

	it('does not resolve the database type when listing options without a search', async () => {
		mocks.getFilterOptionsCache.mockResolvedValue(null);

		await getStoryFilterOptions('chat-1', 'story', 'category');

		expect(mocks.resolveRawSqlDatabaseType).not.toHaveBeenCalled();
	});

	it('marks the list incomplete when the warehouse returns more than the limit', async () => {
		mocks.getFilterOptionsCache.mockResolvedValue(null);
		const rows = Array.from({ length: 101 }, (_, index) => ({ value: `v${String(index).padStart(3, '0')}` }));
		mocks.executeRawSql.mockResolvedValue({ data: rows, columns: ['value'] });

		const result = await getStoryFilterOptions('chat-1', 'story', 'category');

		expect(result.isComplete).toBe(false);
		expect(result.options).toHaveLength(100);
	});

	it('returns hardcoded options without touching the warehouse or cache', async () => {
		const result = await getStoryFilterOptions('chat-1', 'story', 'region');

		expect(result).toEqual({ options: ['EU', 'US'], isComplete: true });
		expect(mocks.getFilterOptionsCache).not.toHaveBeenCalled();
	});

	it('executes an options query with viewer row security', async () => {
		const code = '<filter id="customer" type="select" options_query_id="query_customer_options" />';
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ code });
		const query = { sqlQuery: 'SELECT customer AS value FROM customers', adminMode: false };
		mocks.getSqlQueriesFromCode.mockResolvedValue({ query_customer_options: query });
		mocks.hasRowSecurity.mockResolvedValue(true);
		mocks.executeStoryQueries.mockResolvedValue({
			query_customer_options: {
				columns: ['value'],
				data: [{ value: 'Charlie' }, { value: null }, { value: 'Alice' }, { value: 'Charlie' }],
			},
		});

		const result = await getStoryFilterOptions(
			'chat-1',
			'story',
			'customer',
			{},
			{ billingAccessVerifiedProjectId: 'project-1', viewerUserId: 'viewer-1' },
		);

		expect(result).toEqual({ options: ['Alice', 'Charlie'], isComplete: true });
		expect(mocks.createStoryExecutionContext).toHaveBeenCalledWith('chat-1', 'viewer-1');
		expect(mocks.executeStoryQueries).toHaveBeenCalledWith(
			'chat-1',
			{
				query_customer_options: {
					...query,
					semanticQuery: undefined,
					sqlQuery:
						'SELECT DISTINCT value FROM (SELECT customer AS value FROM customers) AS nao_filter_options WHERE value IS NOT NULL ORDER BY value LIMIT 101',
				},
			},
			expect.objectContaining({
				executionContext: expect.anything(),
				billingAccessVerifiedProjectId: 'project-1',
			}),
		);
		expect(mocks.getFilterOptionsCache).not.toHaveBeenCalled();
	});

	it('returns no options when the options query is unavailable to the viewer', async () => {
		mocks.hasRowSecurity.mockResolvedValue(true);
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			code: '<filter id="customer" type="select" options_query_id="query_customer_options" />',
		});
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_customer_options: { sqlQuery: 'SELECT customer AS value FROM customers', adminMode: false },
		});
		mocks.executeStoryQueries.mockResolvedValue({
			query_customer_options: { columns: [], data: [], accessDenied: true },
		});

		await expect(
			getStoryFilterOptions('chat-1', 'story', 'customer', {}, { viewerUserId: 'viewer-1' }),
		).resolves.toEqual({
			options: [],
			isComplete: true,
		});

		expect(mocks.createStoryExecutionContext).toHaveBeenCalledWith('chat-1', 'viewer-1');
		expect(mocks.getFilterOptionsCache).not.toHaveBeenCalled();
	});

	it('searches and limits options queries before execution', async () => {
		const code = '<filter id="customer" type="select" options_query_id="query_customer_options" />';
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ code });
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_customer_options: {
				sqlQuery: 'SELECT customer AS value FROM customers',
				dialect: 'bigquery',
				adminMode: false,
			},
		});
		mocks.executeStoryQueries.mockResolvedValue({
			query_customer_options: { columns: ['value'], data: [{ value: 'Alice' }] },
		});

		await getStoryFilterOptions('chat-1', 'story', 'customer', { search: 'ali' });

		expect(mocks.executeStoryQueries.mock.calls[0][1].query_customer_options.sqlQuery).toBe(
			"SELECT DISTINCT value FROM (SELECT customer AS value FROM customers) AS nao_filter_options WHERE value IS NOT NULL AND LOWER(CAST(value AS STRING)) LIKE '%ali%' ORDER BY value LIMIT 101",
		);
	});

	it('pages bounded query-backed searches containing apostrophes or backslashes', async () => {
		const code = '<filter id="customer" type="select" options_query_id="query_customer_options" />';
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ code });
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_customer_options: {
				sqlQuery: 'SELECT customer AS value FROM customers',
				dialect: 'bigquery',
				adminMode: false,
			},
		});

		for (const search of ["O'Reilly", String.raw`C:\Sales`]) {
			mocks.executeStoryQueries.mockClear();
			mocks.executeStoryQueries.mockImplementation(async (_chatId, queries) => {
				const sqlQuery = queries.query_customer_options.sqlQuery;
				expect(sqlQuery).toContain(
					`LOWER(CAST(value AS STRING)) LIKE '%${search.toLowerCase().replace(/['\\]/g, '_')}%'`,
				);
				expect(sqlQuery).toContain('LIMIT 101');
				return {
					query_customer_options: {
						columns: ['value'],
						data: sqlQuery.includes('OFFSET 101')
							? [{ value: search }]
							: Array.from({ length: 101 }, (_, index) => ({ value: `broad-match-${index}` })),
					},
				};
			});

			await expect(getStoryFilterOptions('chat-1', 'story', 'customer', { search })).resolves.toEqual({
				options: [search],
				isComplete: true,
			});
			expect(mocks.executeStoryQueries).toHaveBeenCalledTimes(2);
			expect(mocks.executeStoryQueries.mock.calls[1][1].query_customer_options.sqlQuery).toContain(
				'LIMIT 101 OFFSET 101',
			);
		}
	});

	it('applies the parent selection to a query-backed child filter', async () => {
		const code = [
			'<filter id="category" type="select" table="products" column="category" />',
			'<filter id="subcategory" type="select" options_query_id="query_subcategories" depends_on="category" />',
		].join('\n');
		const sqlQuery =
			'SELECT DISTINCT subcategory AS value FROM products WHERE 1 = 1 ' +
			'{% filter category %} AND category IN ({{ filters.category.sql }}) {% endfilter %}';
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ code });
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_subcategories: { sqlQuery, adminMode: false },
		});
		mocks.executeStoryQueries.mockImplementation(async (_chatId, queries) => {
			expect(queries.query_subcategories.sqlQuery).toBe(
				"SELECT DISTINCT value FROM (SELECT DISTINCT subcategory AS value FROM products WHERE 1 = 1  AND category IN ('Kid''s')) AS nao_filter_options WHERE value IS NOT NULL ORDER BY value LIMIT 101",
			);
			return { query_subcategories: { columns: ['value'], data: [{ value: 'Toys' }] } };
		});

		await expect(
			getStoryFilterOptions('chat-1', 'story', 'subcategory', { parentSelection: "Kid's" }),
		).resolves.toEqual({ options: ['Toys'], isComplete: true });

		expect(mocks.upsertFilterOptionsCache).toHaveBeenCalledWith('story-1', expect.any(String), ['Toys'], true);
	});

	it('rejects an options query without a value column', async () => {
		const code = '<filter id="customer" type="select" options_query_id="query_customer_options" />';
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ code });
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_customer_options: { sqlQuery: 'SELECT customer FROM customers', adminMode: false },
		});
		mocks.executeStoryQueries.mockResolvedValue({
			query_customer_options: { columns: ['customer'], data: [{ customer: 'Alice' }] },
		});

		await expect(getStoryFilterOptions('chat-1', 'story', 'customer')).rejects.toThrow(
			'must return a column named "value"',
		);
	});

	it('rejects admin-mode options queries for viewers', async () => {
		const code = '<filter id="customer" type="select" options_query_id="query_customer_options" />';
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ code });
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_customer_options: { sqlQuery: 'SELECT name AS value FROM user', adminMode: true },
		});
		mocks.hasRowSecurity.mockResolvedValue(true);

		await expect(
			getStoryFilterOptions('chat-1', 'story', 'customer', {}, { viewerUserId: 'viewer-1' }),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });

		expect(mocks.executeStoryQueries).not.toHaveBeenCalled();
	});

	it('intersects configured options with values visible to an RLS viewer', async () => {
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			code: `<filter id="customer" type="select" table="customers" column="name" options='["Alice","Bob"]' />`,
		});
		mocks.hasRowSecurity.mockResolvedValue(true);
		mocks.executeRawSql.mockResolvedValue({
			columns: ['value'],
			data: [{ value: 'Bob' }, { value: 'Not configured' }],
		});

		const result = await getStoryFilterOptions('chat-1', 'story', 'customer', {}, { viewerUserId: 'viewer-1' });

		expect(result).toEqual({ options: ['Bob'], isComplete: true });
		expect(mocks.createStoryExecutionContext).toHaveBeenCalledWith('chat-1', 'viewer-1');
		expect(mocks.getFilterOptionsCache).not.toHaveBeenCalled();
	});

	it('hides hardcoded-only options from an RLS viewer', async () => {
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			code: `<filter id="customer" type="select" options='["Alice","Bob"]' />`,
		});
		mocks.hasRowSecurity.mockResolvedValue(true);

		const result = await getStoryFilterOptions('chat-1', 'story', 'customer', {}, { viewerUserId: 'viewer-1' });

		expect(result).toEqual({ options: [], isComplete: true });
		expect(mocks.executeRawSql).not.toHaveBeenCalled();
	});
});

describe('warmStoryFilterOptions', () => {
	it('refreshes only top-level table filters and prunes old cache entries', async () => {
		vi.clearAllMocks();
		mocks.getStoryByChatAndSlug.mockResolvedValue({ id: 'story-1', projectId: 'project-1', cacheSchedule: null });
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ code: STORY_CODE });
		mocks.getSqlQueriesFromCode.mockResolvedValue({});
		mocks.createStoryExecutionContext.mockResolvedValue({ toolContext: { projectFolder: '/project' } });
		mocks.executeRawSql.mockResolvedValue({ data: [{ value: 'Home' }], columns: ['value'] });

		await warmStoryFilterOptions('chat-1', 'story');

		expect(mocks.executeRawSql).toHaveBeenCalledTimes(1);
		expect(mocks.executeRawSql.mock.calls[0][0]).toContain('SELECT DISTINCT category');
		expect(mocks.deleteFilterOptionsCacheOlderThan).toHaveBeenCalledWith('story-1', expect.any(Date));
	});
});

describe('getStoryFilterOptions for semantic layer dimensions', () => {
	const SEMANTIC_CODE = [
		'<filter id="category" type="select" dimension="product__category" />',
		'<filter id="subcategory" type="multi_select" dimension="product__subcategory" depends_on="category" />',
		'<filter id="region" type="select" dimension="customer__region" metric="orders" />',
	].join('\n');

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getStoryByChatAndSlug.mockResolvedValue({ id: 'story-1', projectId: 'project-1', cacheSchedule: null });
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ code: SEMANTIC_CODE });
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			q1: {
				sqlQuery: 'SELECT 1',
				adminMode: false,
				semanticQuery: { metrics: ['{{ params.metric }}'], params: { metric: 'unique_sales' } },
			},
			q2: { sqlQuery: 'SELECT 1', adminMode: false, semanticQuery: { metrics: ['revenue'] } },
		});
		mocks.getFilterOptionsCache.mockResolvedValue(null);
		mocks.createStoryExecutionContext.mockResolvedValue({ toolContext: {} });
		mocks.describeSemanticLayer.mockResolvedValue({
			metrics: [
				{ name: 'unique_sales', label: null, description: null, dimensions: ['customer__region'] },
				{
					name: 'revenue',
					label: null,
					description: null,
					dimensions: ['product__category', 'product__subcategory'],
				},
			],
			dimensions: [],
		});
		mocks.compileSemanticQuery.mockResolvedValue({
			sql: 'SELECT compiled',
			database_id: 'warehouse',
			dialect: 'snowflake',
		});
		mocks.executeRawSql.mockResolvedValue({
			data: [{ PRODUCT__CATEGORY: 'Toys' }, { PRODUCT__CATEGORY: 'Books' }],
			columns: ['PRODUCT__CATEGORY'],
		});
	});

	it('lists values through the semantic layer with a story metric that supports the dimension', async () => {
		const result = await getStoryFilterOptions('chat-1', 'story', 'category');

		expect(result).toEqual({ options: ['Books', 'Toys'], isComplete: true });
		expect(mocks.compileSemanticQuery).toHaveBeenCalledWith(
			{ metrics: ['revenue'], group_by: ['product__category'], order_by: ['product__category'], limit: 101 },
			{},
		);
		expect(mocks.executeRawSql).toHaveBeenCalledWith(
			'SELECT compiled',
			expect.objectContaining({ databaseId: 'warehouse' }),
		);
	});

	it('uses the explicit metric of the filter tag', async () => {
		await getStoryFilterOptions('chat-1', 'story', 'region');

		expect(mocks.compileSemanticQuery.mock.calls[0][0].metrics).toEqual(['orders']);
		expect(mocks.describeSemanticLayer).not.toHaveBeenCalled();
	});

	it('narrows by the parent dimension and searches with the dimension expression', async () => {
		await getStoryFilterOptions('chat-1', 'story', 'subcategory', { parentSelection: 'Toys', search: 'Lego' });

		expect(mocks.compileSemanticQuery.mock.calls[0][0].where).toEqual([
			"{{ Dimension('product__category') }} IN ('Toys')",
			"LOWER({{ Dimension('product__subcategory') }}) LIKE '%lego%'",
		]);
	});
});
