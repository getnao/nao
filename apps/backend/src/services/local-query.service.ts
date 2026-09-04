import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fileExtension } from '@nao/shared/attachments';
import type { executeSql } from '@nao/shared/tools';

import { env } from '../env';
import type { QueryResult, ToolContext } from '../types/tools';
import { referencedQueryIds, rewriteStorageLiterals, storagePathsIn } from '../utils/sql-file-paths';
import {
	isStoragePath,
	STORAGE_MOUNT,
	toStorageRelativePath,
	toStorageScope,
	toStorageVirtualPath,
} from '../utils/tools';
import { runLocalQuery } from './duckdb.service';
import { getQueryResult } from './query-result.service';
import { isStorageEnabled, relativePathFromKey, STORAGE_DISABLED_MESSAGE } from './storage';
import { openStorageFiles } from './storage/file-access';
import { assertWithinStorageSizeLimit, writeUserFileFromDisk } from './storage/user-files';

export interface LocalQueryOutcome {
	result: QueryResult;
	/** Where the result was kept, when the caller asked for it to be saved. */
	savedFile?: { path: string; size: number };
}

/**
 * Runs a query against nao's own DuckDB rather than a warehouse: files by path, earlier query
 * results by id, and joins across the two.
 *
 * Two translations happen before DuckDB sees anything. Paths under `/home` become the real paths
 * the files live at, which differ per user and per storage backend, and every `query_…` the SQL
 * mentions is materialised as a table. DuckDB is then confined to just the directories those
 * translations produced.
 */
export async function runQueryOnLocalFiles(
	sql: string,
	context: ToolContext,
	saveTo?: executeSql.SaveTo,
): Promise<LocalQueryOutcome> {
	const destination = saveTo ? resolveDestination(saveTo) : null;
	const access = await openStorageFilesFor(sql, context);
	const staging = destination ? await stageOutputFile(destination) : null;

	try {
		const result = await runLocalQuery({
			sql: access.sql,
			queryResults: await collectReferencedResults(sql, context),
			allowedDirectories: [
				context.projectFolder,
				...(env.NAO_MCP_SCRATCH_DIR ? [env.NAO_MCP_SCRATCH_DIR] : []),
				...access.directories,
				...(staging ? [staging.directory] : []),
			],
			...(staging && { output: { filePath: staging.filePath, format: staging.format } }),
		});

		return { result, ...(staging && { savedFile: await keepOutputFile(staging, context) }) };
	} finally {
		await access.release();
		await staging?.release();
	}
}

interface Destination {
	/** Path inside the user's storage space. */
	relativePath: string;
	format: executeSql.SaveFormat;
}

interface StagedOutput extends Destination {
	/** A directory only this query can see, which DuckDB is allowed to write into. */
	directory: string;
	filePath: string;
	release: () => Promise<void>;
}

/**
 * Checks where the result is meant to end up before the query runs, so a destination the agent
 * cannot use is reported instead of being discovered once the rows are already computed.
 */
function resolveDestination({ path, format }: executeSql.SaveTo): Destination {
	if (!isStorageEnabled()) {
		throw new Error(STORAGE_DISABLED_MESSAGE);
	}

	if (!isStoragePath(path)) {
		throw new Error(`Cannot save to '${path}': results can only be kept under /${STORAGE_MOUNT}.`);
	}

	const relativePath = toStorageRelativePath(path);
	if (relativePath === '') {
		throw new Error(`save_to needs the path of a file, not the /${STORAGE_MOUNT} root.`);
	}

	if (fileExtension(relativePath) !== format) {
		throw new Error(`A ${format} result has to be saved to a .${format} file, so '${path}' cannot be its name.`);
	}

	return { relativePath, format };
}

/**
 * DuckDB writes into a directory only this query can see, never straight into the user's space:
 * the `s3` backend has no filesystem to write to, and the size limit is only enforceable on a
 * file that is not yet in storage.
 */
async function stageOutputFile(destination: Destination): Promise<StagedOutput> {
	const directory = await mkdtemp(join(tmpdir(), 'nao-local-query-out-'));

	return {
		...destination,
		directory,
		filePath: join(directory, `result.${destination.format}`),
		release: () => rm(directory, { recursive: true, force: true }),
	};
}

/** Checks the size against the file rather than its bytes, so an oversized result is never read in. */
async function keepOutputFile(
	{ filePath, relativePath }: StagedOutput,
	context: ToolContext,
): Promise<{ path: string; size: number }> {
	assertWithinStorageSizeLimit(relativePath, (await stat(filePath)).size);

	const scope = toStorageScope(context);
	const object = await writeUserFileFromDisk(scope, relativePath, filePath);

	return { path: toStorageVirtualPath(relativePathFromKey(scope, object.key)), size: object.size };
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
