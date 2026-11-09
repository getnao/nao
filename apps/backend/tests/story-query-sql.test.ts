import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getLatestVersionByChatAndSlug: vi.fn(),
	getSqlQueriesFromCode: vi.fn(),
	createStoryExecutionContext: vi.fn(),
	compileSemanticQuery: vi.fn(),
	describeSemanticLayerCached: vi.fn(),
}));

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/story.queries', () => ({
	getLatestVersionByChatAndSlug: mocks.getLatestVersionByChatAndSlug,
	getSqlQueriesFromCode: mocks.getSqlQueriesFromCode,
}));
vi.mock('../src/services/live-story', () => ({
	createStoryExecutionContext: mocks.createStoryExecutionContext,
	executeStoryQueries: vi.fn(),
}));
vi.mock('../src/services/semantic-layer.service', () => ({
	compileSemanticQuery: mocks.compileSemanticQuery,
	describeSemanticLayerCached: mocks.describeSemanticLayerCached,
}));

import { getStoryQuerySql } from '../src/services/story-filters';

const SAVED_QUERY = {
	metrics: ['revenue'],
	where: ["{{ Dimension('order__status') }} = '{{ params.status }}'"],
	params: { status: 'completed' },
};

describe('getStoryQuerySql for semantic-layer queries', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({
			code: `<parameter id="status" options='["completed","returned"]' />`,
		});
		mocks.getSqlQueriesFromCode.mockResolvedValue({
			query_1: { sqlQuery: 'SELECT saved', adminMode: false, semanticQuery: SAVED_QUERY },
		});
		mocks.createStoryExecutionContext.mockResolvedValue({ toolContext: {} });
		mocks.describeSemanticLayerCached.mockResolvedValue(null);
		mocks.compileSemanticQuery.mockResolvedValue({
			sql: 'SELECT bound',
			database_id: 'warehouse',
			dialect: 'duckdb',
		});
	});

	it('keeps the saved query editable and previews the resolved one separately', async () => {
		const result = await getStoryQuerySql('chat-1', 'story', 'query_1', { status: 'returned' });

		expect(result.semanticQuery).toEqual(SAVED_QUERY);
		expect(result.effectiveSemanticQuery).toEqual({
			metrics: ['revenue'],
			where: ["{{ Dimension('order__status') }} = 'returned'"],
		});
		expect(result.renderedSql).toBe('SELECT bound');
		expect(result.sqlQuery).toBe('SELECT saved');
	});
});
