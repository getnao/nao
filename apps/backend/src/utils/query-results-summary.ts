import type { QueryResult } from '../types/tools';

export const QUERY_SUMMARY_PREVIEW_ROWS = 3;

export interface QueryResultSummary {
	id: string;
	/** The SQL that produced the result, when it ran in this run. */
	sql?: string;
	columns: string[];
	row_count: number;
	preview: Record<string, unknown>[];
}

/** One entry per query result: what `ask_nao` returns so a calling agent can chart, cite or re-run it. */
export function summarizeQueryResults(results: Map<string, QueryResult>): QueryResultSummary[] {
	return [...results.entries()].map(([id, result]) => ({
		id,
		...(result.sqlQuery ? { sql: result.sqlQuery } : {}),
		columns: result.columns,
		row_count: result.data.length,
		preview: result.data.slice(0, QUERY_SUMMARY_PREVIEW_ROWS),
	}));
}
