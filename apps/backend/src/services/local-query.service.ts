import type { QueryResult, ToolContext } from '../types/tools';
import { referencedQueryIds, rewriteStorageLiterals, storagePathsIn } from '../utils/sql-file-paths';
import { toStorageScope } from '../utils/tools';
import { runLocalQuery } from './duckdb.service';
import { getQueryResult } from './query-result.service';
import { openStorageFiles } from './storage/file-access';

/**
 * Runs a query against nao's own DuckDB rather than a warehouse: files by path, earlier query
 * results by id, and joins across the two.
 *
 * Two translations happen before DuckDB sees anything. Paths under `/home` become the real paths
 * the files live at, which differ per user and per storage backend, and every `query_…` the SQL
 * mentions is materialised as a table. DuckDB is then confined to just the directories those
 * translations produced.
 */
export async function runQueryOnLocalFiles(sql: string, context: ToolContext): Promise<QueryResult> {
	const access = await openStorageFilesFor(sql, context);

	try {
		return await runLocalQuery({
			sql: access.sql,
			queryResults: await collectReferencedResults(sql, context),
			allowedDirectories: [context.projectFolder, ...access.directories],
		});
	} finally {
		await access.release();
	}
}

/**
 * Resolves the `/home` paths in the query to real ones, and reports the directories that has to
 * make reachable. A query touching no saved file needs no storage at all, so it keeps working on
 * instances where storage is switched off.
 */
async function openStorageFilesFor(
	sql: string,
	context: ToolContext,
): Promise<{ sql: string; directories: string[]; release: () => Promise<void> }> {
	const storagePaths = storagePathsIn(sql);

	if (storagePaths.length === 0) {
		return { sql, directories: [], release: async () => {} };
	}

	const access = await openStorageFiles(toStorageScope(context), storagePaths);
	const rewritten = rewriteStorageLiterals(sql, access.realPathOf);

	return { sql: rewritten.sql, directories: [access.directory], release: access.release };
}

async function collectReferencedResults(sql: string, context: ToolContext): Promise<Map<string, QueryResult>> {
	const results = new Map<string, QueryResult>();

	for (const queryId of referencedQueryIds(sql)) {
		const result = await getQueryResult(context, queryId);
		if (result) {
			results.set(queryId, result);
		}
	}

	return results;
}
