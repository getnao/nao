import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getStoryTemplateWarnings, sqlQueriesFromResults } from '../src/services/story-template-validation';

const mocks = vi.hoisted(() => ({
	getLatestSqlQueriesByIds: vi.fn(),
	storyFiltersEnabled: false,
}));

vi.mock('../src/queries/execute-sql.queries', () => ({
	getLatestSqlQueriesByIds: mocks.getLatestSqlQueriesByIds,
}));

vi.mock('../src/env', () => ({
	env: {
		get BETA_STORY_FILTERS_ENABLED() {
			return mocks.storyFiltersEnabled;
		},
	},
}));

const PREVIOUS_TURN_ID = 'query_aaaa1111';
const SAME_TURN_ID = 'query_bbbb2222';
const UNKNOWN_ID = 'query_cccc3333';

function storyCode(...queryIds: string[]): string {
	return queryIds.map((queryId) => `<chart query_id="${queryId}" chart_type="bar" x_axis_key="x" />`).join('\n');
}

function missingQueryWarning(queryId: string): string {
	return `Story references query_id "${queryId}", which was not produced by any execute_sql call in this chat.`;
}

describe('getStoryTemplateWarnings', () => {
	beforeEach(() => {
		mocks.storyFiltersEnabled = false;
		mocks.getLatestSqlQueriesByIds.mockReset();
		mocks.getLatestSqlQueriesByIds.mockImplementation(async (_chatId: string, ids: Set<string>) =>
			ids.has(PREVIOUS_TURN_ID) ? { [PREVIOUS_TURN_ID]: { sqlQuery: 'SELECT 1', adminMode: false } } : {},
		);
	});

	it('does not flag a query id that only exists in the current turn', async () => {
		const warnings = await getStoryTemplateWarnings('chat-1', storyCode(SAME_TURN_ID), {
			[SAME_TURN_ID]: { sqlQuery: 'SELECT 2' },
		});

		expect(warnings).toEqual([]);
	});

	it('still flags a query id that exists nowhere', async () => {
		const warnings = await getStoryTemplateWarnings('chat-1', storyCode(UNKNOWN_ID), {
			[SAME_TURN_ID]: { sqlQuery: 'SELECT 2' },
		});

		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain(missingQueryWarning(UNKNOWN_ID));
	});

	it('still resolves a query id persisted by a previous turn', async () => {
		const warnings = await getStoryTemplateWarnings('chat-1', storyCode(PREVIOUS_TURN_ID, SAME_TURN_ID), {
			[SAME_TURN_ID]: { sqlQuery: 'SELECT 2' },
		});

		expect(warnings).toEqual([]);
		expect(mocks.getLatestSqlQueriesByIds).toHaveBeenCalledWith('chat-1', new Set([PREVIOUS_TURN_ID]));
	});

	it('skips the database lookup when every referenced id comes from the current turn', async () => {
		await getStoryTemplateWarnings('chat-1', storyCode(SAME_TURN_ID), { [SAME_TURN_ID]: { sqlQuery: 'SELECT 2' } });

		expect(mocks.getLatestSqlQueriesByIds).not.toHaveBeenCalled();
	});

	it('uses same-turn SQL for filter checks so same-turn filter usage is not reported as unused', async () => {
		mocks.storyFiltersEnabled = true;
		const code = [
			'<filter id="country" label="Country" type="select" options=\'["fr"]\' />',
			storyCode(SAME_TURN_ID),
		].join('\n');
		const sqlQuery =
			'SELECT 1 FROM t WHERE 1 = 1 {% filter country %} AND country IN ({{ filters.country.sql }}) {% endfilter %}';

		const warnings = await getStoryTemplateWarnings('chat-1', code, { [SAME_TURN_ID]: { sqlQuery } });

		expect(warnings).toEqual([]);
	});
});

describe('sqlQueriesFromResults', () => {
	it('keeps only results that carry their SQL', () => {
		const results = new Map([
			[SAME_TURN_ID, { columns: [], data: [], sqlQuery: 'SELECT 2', databaseId: 'db-1' }],
			[PREVIOUS_TURN_ID, { columns: [], data: [] }],
		]);

		expect(sqlQueriesFromResults(results)).toEqual({
			[SAME_TURN_ID]: { sqlQuery: 'SELECT 2', databaseId: 'db-1' },
		});
	});
});
