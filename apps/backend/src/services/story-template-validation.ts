import { findUnreferencedStoryFilters, validateSqlFilterTemplate } from '@nao/shared/sql-template';
import { getStoryFiltersFromCode } from '@nao/shared/story-segments';

import { env } from '../env';
import * as storyQueries from '../queries/story.queries';

export async function getStoryTemplateWarnings(chatId: string, code: string): Promise<string[]> {
	if (!env.BETA_STORY_FILTERS_ENABLED) {
		return [];
	}

	const filters = getStoryFiltersFromCode(code);
	const knownFilterIds = filters.map((filter) => filter.id);
	const sqlQueries = await storyQueries.getSqlQueriesFromCode(chatId, code);
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
