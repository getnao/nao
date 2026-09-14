import { findUnreferencedStoryFilters, validateSqlFilterTemplate } from '@nao/shared/sql-template';
import { extractQueryIds, findConflictingStoryFilterIds, getStoryFiltersFromCode } from '@nao/shared/story-segments';
import { QueryIdSchema } from '@nao/shared/tools';

import { env } from '../env';
import * as executeSqlQueries from '../queries/execute-sql.queries';

type SqlQueryMap = Record<string, { sqlQuery: string; databaseId?: string }>;

export async function getStoryTemplateWarnings(
	chatId: string,
	code: string,
	currentSqlQueries: SqlQueryMap = {},
): Promise<string[]> {
	const warnings: string[] = [];
	const { wellFormedIds, malformedWarnings } = partitionReferencedQueryIds(code);
	warnings.push(...malformedWarnings);

	const currentReferencedQueries = Object.fromEntries(
		[...wellFormedIds].flatMap((queryId) =>
			currentSqlQueries[queryId] ? [[queryId, currentSqlQueries[queryId]]] : [],
		),
	);
	const persistedIds = new Set([...wellFormedIds].filter((queryId) => !currentReferencedQueries[queryId]));
	const persistedQueries =
		persistedIds.size > 0 ? await executeSqlQueries.getLatestSqlQueriesByIds(chatId, persistedIds) : {};
	const sqlQueries = { ...persistedQueries, ...currentReferencedQueries };

	warnings.push(...getMissingQueryWarnings(wellFormedIds, sqlQueries));

	if (env.BETA_STORY_FILTERS_ENABLED) {
		warnings.push(...getFilterWarnings(code, sqlQueries));
	}

	return warnings;
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
	const knownFilterIds = [...new Set(filters.map((filter) => filter.id))];
	const warnings: string[] = [];

	for (const filterId of findConflictingStoryFilterIds(filters)) {
		warnings.push(
			`Story declares conflicting <filter> definitions with id "${filterId}". Repeated declarations must be identical so selections and SQL rendering use the same definition.`,
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
