import {
	renderSqlTemplate,
	type StoryFilterSelections,
	type StoryFilterTypeById,
	stripSqlFilterBlocks,
} from '@nao/shared/sql-template';
import { getStoryFiltersFromCode } from '@nao/shared/story-segments';
import { LOCAL_DATABASE_ID } from '@nao/shared/tools';
import { TRPCError } from '@trpc/server';

import { env } from '../env';
import * as storyQueries from '../queries/story.queries';
import { assertSafeSqlIdentifier } from '../utils/sql-identifiers';
import { createStoryExecutionContext, executeRawSql, executeStoryQueries } from './live-story';

const FILTER_OPTIONS_LIMIT = 100;

export function assertStoryFiltersEnabled() {
	if (!env.BETA_STORY_FILTERS_ENABLED) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Story filters are disabled on this instance.' });
	}
}

export async function getStoryFilterOptions(
	chatId: string,
	storySlug: string,
	filterId: string,
): Promise<{ options: string[] }> {
	const { code, executionContext, databaseId } = await loadStoryExecutionContext(chatId, storySlug);
	const filter = getStoryFiltersFromCode(code).find((candidate) => candidate.id === filterId);
	if (!filter) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `Filter "${filterId}" not found in story.` });
	}

	if (filter.options?.length) {
		return { options: [...new Set(filter.options)] };
	}

	if (!filter.table || !filter.column) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `Filter "${filterId}" has no hardcoded options and is missing table/column.`,
		});
	}

	const table = assertSafeSqlIdentifier(filter.table, 'table');
	const column = assertSafeSqlIdentifier(filter.column, 'column');
	const sql = `SELECT DISTINCT ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL ORDER BY ${column} LIMIT ${FILTER_OPTIONS_LIMIT}`;
	const result = await executeRawSql(sql, {
		executionContext,
		databaseId: filter.databaseId ?? databaseId,
	});
	const options = result.data
		.map((row) => {
			if (!row || typeof row !== 'object') {
				return null;
			}
			const value = (row as Record<string, unknown>).value;
			return value === null || value === undefined ? null : String(value);
		})
		.filter((value): value is string => value !== null && value.trim() !== '');

	return { options: [...new Set(options)].sort((a, b) => a.localeCompare(b)) };
}

export async function getFilteredStoryQueryData(
	chatId: string,
	storySlug: string,
	selections: StoryFilterSelections,
): Promise<Record<string, { data: unknown[]; columns: string[] }>> {
	const { code, executionContext, sqlQueries } = await loadStoryExecutionContext(chatId, storySlug);
	const types = filterTypesFromCode(code);

	return executeStoryQueries(chatId, sqlQueries, {
		executionContext,
		renderSql: (sqlQuery) => renderStorySql(sqlQuery, selections, types),
	});
}

export async function getStoryQuerySql(
	chatId: string,
	storySlug: string,
	queryId: string,
	selections: StoryFilterSelections = {},
): Promise<{ sqlQuery: string; renderedSql: string }> {
	const { code, sqlQueries } = await loadStoryCodeAndQueries(chatId, storySlug);
	const query = sqlQueries[queryId];
	if (!query) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `Query "${queryId}" not found.` });
	}

	return {
		sqlQuery: query.sqlQuery,
		renderedSql: renderStorySql(query.sqlQuery, selections, filterTypesFromCode(code)),
	};
}

function filterTypesFromCode(code: string): StoryFilterTypeById {
	return Object.fromEntries(getStoryFiltersFromCode(code).map((filter) => [filter.id, filter.filterType]));
}

function renderStorySql(sqlQuery: string, selections: StoryFilterSelections, types: StoryFilterTypeById): string {
	return Object.keys(selections).length === 0
		? stripSqlFilterBlocks(sqlQuery)
		: renderSqlTemplate(sqlQuery, selections, types);
}

async function loadStoryExecutionContext(chatId: string, storySlug: string) {
	const [{ code, sqlQueries }, executionContext] = await Promise.all([
		loadStoryCodeAndQueries(chatId, storySlug),
		createStoryExecutionContext(chatId),
	]);
	const databaseIds = Object.values(sqlQueries).flatMap((query) => (query.databaseId ? [query.databaseId] : []));
	const databaseId = databaseIds.find((id) => id !== LOCAL_DATABASE_ID) ?? databaseIds[0];

	return {
		code,
		executionContext,
		databaseId,
		sqlQueries,
	};
}

async function loadStoryCodeAndQueries(chatId: string, storySlug: string) {
	const version = await storyQueries.getLatestVersionByChatAndSlug(chatId, storySlug);
	if (!version) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
	}

	const sqlQueries = await storyQueries.getSqlQueriesFromCode(chatId, version.code);
	return {
		code: version.code,
		sqlQueries,
	};
}
