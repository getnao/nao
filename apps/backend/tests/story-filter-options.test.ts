import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getLatestVersionByChatAndSlug: vi.fn(),
	getSqlQueriesFromCode: vi.fn(),
	createStoryExecutionContext: vi.fn(),
	executeRawSql: vi.fn(),
}));

vi.mock('../src/env', () => ({ env: { BETA_STORY_FILTERS_ENABLED: true } }));
vi.mock('../src/queries/story.queries', () => ({
	getLatestVersionByChatAndSlug: mocks.getLatestVersionByChatAndSlug,
	getSqlQueriesFromCode: mocks.getSqlQueriesFromCode,
}));
vi.mock('../src/services/live-story', () => ({
	createStoryExecutionContext: mocks.createStoryExecutionContext,
	executeRawSql: mocks.executeRawSql,
	executeStoryQueries: vi.fn(),
}));

import { FILTER_OPTIONS_LIMIT, getStoryFilterOptions } from '../src/services/story-filters';

const COLUMN_FILTER_CODE =
	'<filter id="category" label="Category" type="multi_select" table="products" column="category" />';

describe('getStoryFilterOptions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getSqlQueriesFromCode.mockResolvedValue({ query_products: { databaseId: 'warehouse' } });
		mocks.createStoryExecutionContext.mockResolvedValue({});
	});

	it('returns hardcoded options without querying the warehouse', async () => {
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			code: `<filter id="country" label="Country" type="select" options='["US","FR","US"]' />`,
		});

		await expect(getStoryFilterOptions('chat-1', 'story', 'country')).resolves.toEqual({
			options: ['US', 'FR'],
			truncated: false,
		});
		expect(mocks.executeRawSql).not.toHaveBeenCalled();
	});

	it('loads every distinct value up to the limit', async () => {
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ code: COLUMN_FILTER_CODE });
		mocks.executeRawSql.mockResolvedValue({ data: rowsOf(300), columns: ['value'] });

		const result = await getStoryFilterOptions('chat-1', 'story', 'category');

		expect(result.options).toHaveLength(300);
		expect(result.truncated).toBe(false);
		expect(mocks.executeRawSql).toHaveBeenCalledWith(
			`SELECT DISTINCT category AS value FROM products WHERE category IS NOT NULL ORDER BY category LIMIT ${FILTER_OPTIONS_LIMIT + 1}`,
			expect.objectContaining({ databaseId: 'warehouse' }),
		);
	});

	it('flags the list as truncated when the column has more values than the limit', async () => {
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ code: COLUMN_FILTER_CODE });
		mocks.executeRawSql.mockResolvedValue({ data: rowsOf(FILTER_OPTIONS_LIMIT + 1), columns: ['value'] });

		const result = await getStoryFilterOptions('chat-1', 'story', 'category');

		expect(result.options).toHaveLength(FILTER_OPTIONS_LIMIT);
		expect(result.truncated).toBe(true);
	});
});

function rowsOf(count: number) {
	return Array.from({ length: count }, (_, index) => ({ value: `category-${String(index).padStart(5, '0')}` }));
}
