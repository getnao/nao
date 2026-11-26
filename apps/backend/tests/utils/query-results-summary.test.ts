import { describe, expect, it } from 'vitest';

import type { QueryResult } from '../../src/types/tools';
import { summarizeQueryResults } from '../../src/utils/query-results-summary';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ n: i }));

describe('summarizeQueryResults', () => {
	it('returns the SQL each query ran with its columns, row count and first rows', () => {
		const results = new Map<string, QueryResult>([
			['query_a', { columns: ['n'], data: rows(5), sqlQuery: 'SELECT n FROM t' }],
		]);

		expect(summarizeQueryResults(results)).toEqual([
			{ id: 'query_a', sql: 'SELECT n FROM t', columns: ['n'], row_count: 5, preview: rows(3) },
		]);
	});

	it('leaves sql out when the result has none', () => {
		const results = new Map<string, QueryResult>([['query_b', { columns: ['n'], data: rows(1) }]]);

		expect(summarizeQueryResults(results)).toEqual([
			{ id: 'query_b', columns: ['n'], row_count: 1, preview: rows(1) },
		]);
	});
});
