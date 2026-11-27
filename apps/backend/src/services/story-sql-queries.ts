import { LOCAL_DATABASE_ID } from '@nao/shared/tools';

import { db, type DBExecutor } from '../db/db';
import type { StoredSqlQuery } from '../queries/execute-sql.queries';
import * as executeSqlQueries from '../queries/execute-sql.queries';
import * as mcpQueryDataQueries from '../queries/mcp-query-data.queries';
import * as storyQueryQueries from '../queries/story-query.queries';
import { referencedQueryIds } from '../utils/sql-file-paths';

export type StorySqlQueries = Record<string, StoredSqlQuery>;
export type SqlQueryLoader = (queryIds: Set<string>) => Promise<StorySqlQueries>;

export interface StoryQueryOrigin {
	id: string;
	chatId: string | null;
}

/** A story's chat is where its queries get edited, so it wins; the SQL saved with the story fills in the rest. */
export async function loadStorySqlQueries(
	story: StoryQueryOrigin,
	queryIds: Iterable<string>,
): Promise<StorySqlQueries> {
	const ids = new Set(queryIds);
	if (ids.size === 0) {
		return {};
	}

	const fromChat = story.chatId ? await executeSqlQueries.getLatestSqlQueriesByIds(story.chatId, ids) : {};
	const missing = new Set([...ids].filter((id) => !(id in fromChat)));
	if (missing.size === 0) {
		return fromChat;
	}
	return { ...(await storyQueryQueries.listStoryQueries(story.id, missing)), ...fromChat };
}

/** Queries the given local queries read from, recursively, which are not part of them. */
export async function loadUpstreamSqlQueries(
	sqlQueries: StorySqlQueries,
	loadSqlQueries: SqlQueryLoader,
): Promise<StorySqlQueries> {
	const upstream: StorySqlQueries = {};
	const requested = new Set(Object.keys(sqlQueries));
	let frontier = sqlQueries;

	while (true) {
		const missing = new Set(
			Object.values(frontier)
				.filter((query) => query.databaseId === LOCAL_DATABASE_ID)
				.flatMap((query) => referencedQueryIds(query.sqlQuery))
				.filter((id) => !requested.has(id)),
		);
		if (missing.size === 0) {
			return upstream;
		}
		missing.forEach((id) => requested.add(id));
		frontier = await loadSqlQueries(missing);
		Object.assign(upstream, frontier);
	}
}

export async function copyStoryQueries(
	source: StoryQueryOrigin,
	targetStoryId: string,
	queryIds: Iterable<string>,
	executor: DBExecutor = db,
): Promise<void> {
	await copyQueriesToStory(targetStoryId, queryIds, (ids) => loadStorySqlQueries(source, ids), executor);
}

/** MCP results older than the call log, or whose call is not logged, stay frozen. */
export async function copyMcpQueriesToStory(
	storyId: string,
	queryIds: Iterable<string>,
	owner: { projectId: string; userId: string },
): Promise<void> {
	await copyQueriesToStory(storyId, queryIds, (ids) => mcpQueryDataQueries.getMcpSqlQueriesByIds(ids, owner), db);
}

async function copyQueriesToStory(
	storyId: string,
	queryIds: Iterable<string>,
	loadSqlQueries: SqlQueryLoader,
	executor: DBExecutor,
): Promise<void> {
	const queries = await loadSqlQueries(new Set(queryIds));
	const upstream = await loadUpstreamSqlQueries(queries, loadSqlQueries);
	await storyQueryQueries.upsertStoryQueries(storyId, withSql({ ...upstream, ...queries }), executor);
}

function withSql(queries: StorySqlQueries): StorySqlQueries {
	return Object.fromEntries(
		Object.entries(queries).filter(([, query]) => query.sqlQuery.trim() !== '' || query.semanticQuery),
	);
}
