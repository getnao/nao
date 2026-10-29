import { skipToken, useQuery } from '@tanstack/react-query';
import type { executeSemanticQuery } from '@nao/shared/tools';

import { trpc } from '@/main';

export type SemanticQueryFreshness =
	| { status: 'unknown' }
	| { status: 'current' }
	| { status: 'outdated' }
	| { status: 'broken'; message: string };

export interface SavedSemanticQuery {
	queryId: string;
	semanticQuery: executeSemanticQuery.SemanticQuery;
	compiledSql: string;
}

/**
 * Compiles the saved metric query with the semantic layer's current definitions, without running it,
 * to tell whether the result was computed from SQL the layer would no longer produce.
 */
export function useSemanticQueryFreshness(saved: SavedSemanticQuery | null): SemanticQueryFreshness {
	const compiled = useQuery({
		...trpc.sql.compileSemanticQuery.queryOptions(
			saved ? { queryId: saved.queryId, query: saved.semanticQuery } : skipToken,
		),
		retry: false,
	});

	if (!saved) {
		return { status: 'unknown' };
	}
	if (compiled.isError) {
		return { status: 'broken', message: compiled.error.message };
	}
	if (!compiled.data) {
		return { status: 'unknown' };
	}
	return normalizeSql(compiled.data.sql) === normalizeSql(saved.compiledSql)
		? { status: 'current' }
		: { status: 'outdated' };
}

/** Why a chart built on this query deserves a look, or undefined when its result is up to date. */
export function describeSemanticQueryFreshness(freshness: SemanticQueryFreshness): string | undefined {
	if (freshness.status === 'outdated') {
		return 'The semantic layer definitions changed since this query last ran.';
	}
	if (freshness.status === 'broken') {
		return 'This query no longer compiles with the current semantic layer.';
	}
	return undefined;
}

function normalizeSql(sql: string): string {
	return sql.replace(/\s+/g, ' ').trim();
}
