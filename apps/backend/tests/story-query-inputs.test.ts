import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createStoryExecutionContext: vi.fn(),
	executeStoryQueries: vi.fn(),
	getSqlQueryById: vi.fn(),
}));

vi.mock('../src/services/live-story', () => ({
	createStoryExecutionContext: mocks.createStoryExecutionContext,
	executeStoryQueries: mocks.executeStoryQueries,
}));
vi.mock('../src/queries/story.queries', () => ({ getSqlQueryById: mocks.getSqlQueryById }));

import { executeStoryQueryWithInputs } from '../src/services/story-query-inputs';

const SAVED_SQL =
	'SELECT month, SUM(amount) AS revenue FROM orders WHERE 1 = 1 {% filter status %} AND status = {{ filters.status.sql }} {% endfilter %} GROUP BY 1';
const VIEWER_CONTEXT = { toolContext: { userId: 'viewer-1' }, enforceExcludedColumns: true };

describe('executeStoryQueryWithInputs', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getSqlQueryById.mockResolvedValue({ sqlQuery: SAVED_SQL, adminMode: false });
		mocks.createStoryExecutionContext.mockResolvedValue(VIEWER_CONTEXT);
		mocks.executeStoryQueries.mockResolvedValue({ query_1: { columns: ['revenue'], data: [{ revenue: 10 }] } });
	});

	it('re-runs the saved query as the viewer, never with the story owner’s access', async () => {
		await executeStoryQueryWithInputs(
			'chat-1',
			'query_1',
			{ filters: { status: 'completed' } },
			{ viewerId: 'viewer-1' },
		);

		expect(mocks.createStoryExecutionContext).toHaveBeenCalledWith('chat-1', 'viewer-1');
		expect(mocks.executeStoryQueries.mock.calls[0][2].executionContext).toBe(VIEWER_CONTEXT);
	});

	it('renders the filter blocks of the saved SQL with the quoted values', async () => {
		await executeStoryQueryWithInputs(
			'chat-1',
			'query_1',
			{ filters: { status: "it's" } },
			{ viewerId: 'viewer-1' },
		);

		const { renderSql } = mocks.executeStoryQueries.mock.calls[0][2];
		expect(renderSql(SAVED_SQL)).toContain("AND status = 'it''s'");
	});

	it('hands parameters to semantic queries', async () => {
		await executeStoryQueryWithInputs(
			'chat-1',
			'query_1',
			{ params: { metric: 'revenue' } },
			{ viewerId: 'viewer-1' },
		);

		expect(mocks.executeStoryQueries.mock.calls[0][2].semanticBindings.parameterValues).toEqual({
			metric: 'revenue',
		});
	});
});
