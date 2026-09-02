import {
	renderSqlTemplate,
	type StoryFilterSelections,
	type StoryFilterTypeById,
	stripSqlFilterBlocks,
} from '@nao/shared/sql-template';
import { getStoryFiltersFromCode } from '@nao/shared/story-segments';
import { TRPCError } from '@trpc/server';

import { env } from '../env';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as storyQueries from '../queries/story.queries';
import { assertSafeSqlIdentifier } from '../utils/sql-identifiers';
import { executeRawSql } from './live-story';

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
	const { code, projectId, projectPath, envVars, databaseId } = await loadStoryExecutionContext(chatId, storySlug);
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
		projectFolder: projectPath,
		projectId,
		databaseId: filter.databaseId ?? databaseId,
		envVars,
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
	const { code, projectId, projectPath, envVars, sqlQueries } = await loadStoryExecutionContext(chatId, storySlug);
	const types = filterTypesFromCode(code);
	const queryData: Record<string, { data: unknown[]; columns: string[] }> = {};

	await Promise.all(
		Object.entries(sqlQueries).map(async ([queryId, { sqlQuery, databaseId }]) => {
			const renderedSql = renderStorySql(sqlQuery, selections, types);
			queryData[queryId] = await executeRawSql(renderedSql, {
				projectFolder: projectPath,
				projectId,
				databaseId,
				envVars,
			});
		}),
	);

	return queryData;
}

export async function getStoryQuerySql(
	chatId: string,
	storySlug: string,
	queryId: string,
	selections: StoryFilterSelections = {},
): Promise<{ sqlQuery: string; renderedSql: string }> {
	const { code, sqlQueries } = await loadStoryExecutionContext(chatId, storySlug);
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
	const version = await storyQueries.getLatestVersionByChatAndSlug(chatId, storySlug);
	if (!version) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
	}

	const projectId = await chatQueries.getChatProjectId(chatId);
	if (!projectId) {
		throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Chat project not found.' });
	}

	const project = await projectQueries.retrieveProjectById(projectId);
	if (!project.path) {
		throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Project path not configured.' });
	}

	const [envVars, sqlQueries] = await Promise.all([
		projectQueries.getEnvVars(projectId),
		storyQueries.getSqlQueriesFromCode(chatId, version.code),
	]);
	const databaseId = Object.values(sqlQueries).find((query) => query.databaseId)?.databaseId;

	return {
		code: version.code,
		projectId,
		projectPath: project.path,
		envVars,
		databaseId,
		sqlQueries,
	};
}
