import { findUnreferencedStoryFilters, validateSqlFilterTemplate } from '@nao/shared/sql-template';
import { extractQueryIds, getStoryFiltersFromCode } from '@nao/shared/story-segments';
import { QueryIdSchema } from '@nao/shared/tools';

import { env } from '../env';
import * as executeSqlQueries from '../queries/execute-sql.queries';
import type { QueryResult } from '../types/tools';

export type SqlQueryMap = Record<string, { sqlQuery: string; databaseId?: string }>;

/**
 * Queries run earlier in the current agent turn are not persisted until the turn ends,
 * so callers inside a run pass them as `sameTurnQueries` on top of the DB lookup.
 */
export async function getStoryTemplateWarnings(
	chatId: string,
	code: string,
	sameTurnQueries: SqlQueryMap = {},
): Promise<string[]> {
	const warnings: string[] = [];
	const { wellFormedIds, malformedWarnings } = partitionReferencedQueryIds(code);
	warnings.push(...malformedWarnings);

	const sqlQueries = await resolveSqlQueries(chatId, wellFormedIds, sameTurnQueries);

	warnings.push(...getMissingQueryWarnings(wellFormedIds, sqlQueries));

	if (env.BETA_STORY_FILTERS_ENABLED) {
		warnings.push(...getFilterWarnings(code, sqlQueries));
	}

	return warnings;
}

export function sqlQueriesFromResults(queryResults: ReadonlyMap<string, QueryResult>): SqlQueryMap {
	const sqlQueries: SqlQueryMap = {};
	for (const [queryId, result] of queryResults) {
		if (result.sqlQuery !== undefined) {
			sqlQueries[queryId] = {
				sqlQuery: result.sqlQuery,
				...(result.databaseId && { databaseId: result.databaseId }),
			};
		}
	}
	return sqlQueries;
}

/** Same-turn queries are the freshest version of an id, so they win over persisted ones. */
async function resolveSqlQueries(
	chatId: string,
	referencedIds: Set<string>,
	sameTurnQueries: SqlQueryMap,
): Promise<SqlQueryMap> {
	const sameTurn: SqlQueryMap = {};
	const persistedIds = new Set<string>();
	for (const queryId of referencedIds) {
		if (queryId in sameTurnQueries) {
			sameTurn[queryId] = sameTurnQueries[queryId];
		} else {
			persistedIds.add(queryId);
		}
	}
	const persisted =
		persistedIds.size > 0 ? await executeSqlQueries.getLatestSqlQueriesByIds(chatId, persistedIds) : {};
	return { ...persisted, ...sameTurn };
}

function partitionReferencedQueryIds(code: string): { wellFormedIds: Set<string>; malformedWarnings: string[] } {
	const wellFormedIds = new Set<string>();
	const malformedWarnings: string[] = [];
	for (const queryId of extractQueryIds(code)) {
		if (QueryIdSchema.safeParse(queryId).success) {
			wellFormedIds.add(queryId);
		} else {
			malformedWarnings.push(
				`Story references query_id "${queryId}", which is not a valid query id. Use the exact id returned in an execute_sql tool output (the "id" field, which looks like "query_..."); a chart/table/map block with an invalid query_id renders empty.`,
			);
		}
	}
	return { wellFormedIds, malformedWarnings };
}

function getMissingQueryWarnings(wellFormedIds: Set<string>, sqlQueries: SqlQueryMap): string[] {
	const warnings: string[] = [];
	for (const queryId of wellFormedIds) {
		if (!sqlQueries[queryId]) {
			warnings.push(
				`Story references query_id "${queryId}", which was not produced by any execute_sql call in this chat. Run execute_sql first and use the exact id returned in its output (the "id" field); a chart/table/map block with an unknown query_id renders empty.`,
			);
		}
	}
	return warnings;
}

function getFilterWarnings(code: string, sqlQueries: SqlQueryMap): string[] {
	const filters = getStoryFiltersFromCode(code);
	const knownFilterIds = filters.map((filter) => filter.id);
	const warnings: string[] = [];

	for (const duplicateId of findDuplicateFilterIds(knownFilterIds)) {
		warnings.push(
			`Story declares multiple <filter> tags with id "${duplicateId}". Filter ids must be unique — rename or remove the duplicates so selections and SQL rendering use the same definition.`,
		);
	}

	for (const [queryId, { sqlQuery }] of Object.entries(sqlQueries)) {
		for (const issue of validateSqlFilterTemplate(sqlQuery, { knownFilterIds })) {
			warnings.push(`[${queryId}] ${issue}`);
		}
	}

	if (knownFilterIds.length > 0) {
		const sqlList = Object.values(sqlQueries).map((query) => query.sqlQuery);
		for (const filterId of findUnreferencedStoryFilters(knownFilterIds, sqlList)) {
			warnings.push(
				`Story filter "${filterId}" is declared but not referenced in any chart/table SQL. Add {% filter ${filterId} %} ... {{ filters.${filterId}.sql }} ... {% endfilter %} to the relevant queries, or remove the unused <filter> tag.`,
			);
		}
	}

	return warnings;
}

function findDuplicateFilterIds(filterIds: string[]): string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const filterId of filterIds) {
		if (seen.has(filterId)) {
			duplicates.add(filterId);
		}
		seen.add(filterId);
	}
	return [...duplicates];
}
