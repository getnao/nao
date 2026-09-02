import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DuckDBConnection, DuckDBResultReader } from '@duckdb/node-api';
import type { executeSql } from '@nao/shared/tools';

import { env } from '../env';
import type { QueryResult } from '../types/tools';
import { isReadOnlySqlQuery } from '../utils/sql-filter';

type DuckDBModule = typeof import('@duckdb/node-api');

type SaveFormat = executeSql.SaveFormat;

export interface LocalQueryOutput {
	/** Where to write the result. Must sit inside one of the allowed directories. */
	filePath: string;
	format: SaveFormat;
}

export interface LocalQuery {
	/** Already rewritten to real filesystem paths. */
	sql: string;
	/** Exposed as tables named after their query id. */
	queryResults: Map<string, QueryResult>;
	/** The only directories the query may open files from. */
	allowedDirectories: string[];
	/** When set, the result is also written out as a file. */
	output?: LocalQueryOutput;
}

/**
 * Runs a read-only query in an in-memory DuckDB that can open files on disk, on top of the same
 * query-result tables as {@link runSqlOverQueryResults}. This is what lets a spreadsheet or an
 * export be joined against warehouse rows without either side leaving the machine.
 *
 * The SQL is untrusted, so DuckDB is confined before it runs: file access is narrowed to
 * `allowedDirectories`, everything else external is switched off, and the configuration is locked
 * so the query cannot widen any of it back. The order matters — `allowed_directories` is only
 * settable while external access is still enabled.
 *
 * `output` writes the result to a file. The query itself stays read-only: the `COPY` is written
 * here, against a path the caller resolved, so the untrusted SQL never names a write target.
 */
export async function runLocalQuery({
	sql,
	queryResults,
	allowedDirectories,
	output,
}: LocalQuery): Promise<QueryResult> {
	if (!(await isReadOnlySqlQuery(sql))) {
		throw new Error(
			'Only read-only queries can run against the local database. It reads files and earlier results; it cannot modify them.',
		);
	}

	const duckdb = await loadDuckDB();
	const workspace = await mkdtemp(join(tmpdir(), 'nao-local-query-'));
	const instance = await duckdb.DuckDBInstance.create(':memory:', extensionConfig());
	const connection = await instance.connect();

	try {
		const spreadsheetSupport = await loadSpreadsheetSupport(connection);

		for (const [queryId, queryResult] of queryResults) {
			await createQueryResultTable(connection, workspace, queryId, queryResult);
		}

		await restrictToDirectories(connection, allowedDirectories);

		try {
			return output
				? await runAndWriteOut(connection, sql, output, duckdb)
				: toQueryResult(await connection.runAndReadAll(sql), duckdb);
		} catch (error) {
			throw explainLocalQueryFailure(error, spreadsheetSupport);
		}
	} finally {
		connection.closeSync();
		instance.closeSync();
		await rm(workspace, { recursive: true, force: true });
	}
}

/**
 * Materialises the result once so it can be both written out and returned, rather than running
 * the query a second time to read the rows back.
 */
async function runAndWriteOut(
	connection: DuckDBConnection,
	sql: string,
	output: LocalQueryOutput,
	duckdb: DuckDBModule,
): Promise<QueryResult> {
	const table = quoteIdentifier(SAVED_RESULT_TABLE);

	await connection.run(`CREATE TEMP TABLE ${table} AS (${asSubquery(sql)})`);
	await connection.run(`COPY ${table} TO ${quoteLiteral(output.filePath)} (${copyOptions(output.format)})`);

	return toQueryResult(await connection.runAndReadAll(`SELECT * FROM ${table}`), duckdb);
}

const SAVED_RESULT_TABLE = 'nao_saved_result';

function copyOptions(format: SaveFormat): string {
	return format === 'csv' ? 'FORMAT csv, HEADER' : 'FORMAT parquet';
}

/** A trailing semicolon is harmless on its own but closes the statement this gets wrapped in. */
function asSubquery(sql: string): string {
	return sql.trim().replace(/;+\s*$/, '');
}

/**
 * Narrows DuckDB to a set of directories, then takes away its ability to reach anywhere else or to
 * undo either decision. Reads outside the list, HTTP, globbing the filesystem, `COPY TO` and
 * `ATTACH` all fail from here on.
 */
async function restrictToDirectories(connection: DuckDBConnection, directories: string[]): Promise<void> {
	if (directories.length > 0) {
		await connection.run(`SET allowed_directories = [${directories.map(quoteLiteral).join(', ')}]`);
	}

	await lockDownExternalAccess(connection);
}

/**
 * Spreadsheets need DuckDB's `excel` extension. Images bake it in at build time; elsewhere it is
 * fetched on first use, which needs the network and so has to happen before the lockdown. Failure
 * is deferred rather than raised: it only matters if the query turns out to want a spreadsheet.
 */
async function loadSpreadsheetSupport(connection: DuckDBConnection): Promise<Error | null> {
	try {
		await connection.run('LOAD excel');
		return null;
	} catch {
		// Not baked into the image, so fall through to fetching it.
	}

	try {
		await connection.run('INSTALL excel');
		await connection.run('LOAD excel');
		return null;
	} catch (error) {
		return error instanceof Error ? error : new Error(String(error));
	}
}

function explainLocalQueryFailure(error: unknown, spreadsheetSupport: Error | null): Error {
	const message = error instanceof Error ? error.message : String(error);

	if (spreadsheetSupport && /read_xlsx|\bexcel\b/i.test(message)) {
		return new Error(
			`Reading spreadsheets needs DuckDB's excel extension, which is not available here (${spreadsheetSupport.message}). Convert the file to CSV, or read it in a sandbox with pandas instead.`,
			{ cause: error },
		);
	}

	return error instanceof Error ? error : new Error(message);
}

/** Where a pre-installed extension lives, when the deployment baked one in. */
function extensionConfig(): Record<string, string> {
	return env.DUCKDB_EXTENSION_DIR ? { extension_directory: env.DUCKDB_EXTENSION_DIR } : {};
}

/**
 * Runs a query in an in-memory DuckDB where every given query result is a table
 * named after its query id. Lets callers reshape warehouse rows they already
 * hold instead of moving them through an LLM.
 *
 * The SQL is treated as untrusted: only read-only SELECT/WITH over the provided
 * tables is allowed, and DuckDB external access is disabled before execution.
 */
export async function runSqlOverQueryResults(
	queryResults: Map<string, QueryResult>,
	sql: string,
): Promise<QueryResult> {
	const duckdb = await loadDuckDB();
	const workspace = await mkdtemp(join(tmpdir(), 'nao-query-results-'));
	const instance = await duckdb.DuckDBInstance.create(':memory:');
	const connection = await instance.connect();

	try {
		await assertSafeQueryResultsSql(connection, sql, [...queryResults.keys()]);

		for (const [queryId, queryResult] of queryResults) {
			await createQueryResultTable(connection, workspace, queryId, queryResult);
		}

		await lockDownExternalAccess(connection);

		return toQueryResult(await connection.runAndReadAll(sql), duckdb);
	} finally {
		connection.closeSync();
		instance.closeSync();
		await rm(workspace, { recursive: true, force: true });
	}
}

/**
 * Reads the rows out, turning the numbers DuckDB renders as text back into numbers. BIGINT and
 * DECIMAL arrive as strings so that no precision is lost in JSON, but a count or a sum reaching a
 * chart as `"3"` is worse than the rounding: a value only stays a string when it genuinely cannot
 * survive the trip through a JavaScript number.
 */
function toQueryResult(reader: DuckDBResultReader, { DuckDBTypeId }: DuckDBModule): QueryResult {
	const numericColumns = findNumericColumns(reader, DuckDBTypeId);

	const data = reader.getRowObjectsJson().map((row) => {
		return Object.fromEntries(
			Object.entries(row).map(([column, value]) => [column, toNumber(value, numericColumns.get(column))]),
		);
	});

	return { columns: reader.columnNames(), data };
}

type NumericKind = 'integer' | 'fractional';

function findNumericColumns(
	reader: DuckDBResultReader,
	typeIds: DuckDBModule['DuckDBTypeId'],
): Map<string, NumericKind> {
	const names = reader.deduplicatedColumnNames();
	const integerIds = [typeIds.BIGINT, typeIds.HUGEINT, typeIds.UBIGINT, typeIds.UHUGEINT];

	const numericColumns = new Map<string, NumericKind>();
	reader.columnTypes().forEach((type, index) => {
		const kind = integerIds.includes(type.typeId)
			? 'integer'
			: type.typeId === typeIds.DECIMAL
				? 'fractional'
				: null;
		if (kind) {
			numericColumns.set(names[index]!, kind);
		}
	});

	return numericColumns;
}

function toNumber(value: unknown, kind: NumericKind | undefined): unknown {
	if (!kind || typeof value !== 'string') {
		return value;
	}

	const parsed = Number(value);
	const exactEnough = kind === 'integer' ? Number.isSafeInteger(parsed) : Number.isFinite(parsed);

	return exactEnough ? parsed : value;
}

/**
 * The DuckDB engine is too large to ship inside the nao package, so the CLI
 * downloads it on first use and exposes it through NODE_PATH. Loading it on
 * demand keeps a missing engine from preventing the server from starting.
 */
async function loadDuckDB(): Promise<DuckDBModule> {
	try {
		return await import('@duckdb/node-api');
	} catch (error) {
		throw new Error('The DuckDB engine is not installed — run `nao test` again with network access', {
			cause: error,
		});
	}
}

/**
 * Enforces the read-only, table-allowlisted policy on the untrusted SQL. The query is parsed with
 * DuckDB's own parser (json_serialize_sql) so the dialect checked is exactly the dialect it will
 * run under — an external parser would reject valid DuckDB syntax like TRY_CAST or QUALIFY.
 */
async function assertSafeQueryResultsSql(
	connection: DuckDBConnection,
	sql: string,
	allowedTables: string[],
): Promise<void> {
	if (!(await isReadOnlySqlQuery(sql))) {
		throw new Error('Only read-only SELECT/WITH queries are allowed.');
	}

	const referenced = await referencedBaseTables(connection, sql);
	const allowed = new Set(allowedTables);
	const disallowed = [...new Set(referenced)].filter((name) => !allowed.has(name));
	if (disallowed.length > 0) {
		throw new Error(
			`Query references objects outside the allowlist: ${disallowed.join(', ')}. Allowed: ${allowedTables.join(', ') || '(none)'}.`,
		);
	}
}

async function referencedBaseTables(connection: DuckDBConnection, sql: string): Promise<string[]> {
	const reader = await connection.runAndReadAll('SELECT json_serialize_sql(?::VARCHAR) AS ast', [sql]);
	const ast = JSON.parse(reader.getRowObjectsJson()[0]!.ast as string) as SerializedSqlAst;

	if (ast.error) {
		throw new Error(
			`Could not parse the query as DuckDB; rejected for safety. Rewrite it in DuckDB syntax. ${ast.error_message ?? ''}`.trim(),
		);
	}

	const scan = scanSerializedAst(ast.statements);
	return scan.tables.filter((name) => !scan.cteNames.has(name));
}

interface SerializedSqlAst {
	error: boolean;
	error_message?: string;
	statements?: unknown[];
}

interface AstScan {
	tables: string[];
	cteNames: Set<string>;
}

/** Walks the serialized AST collecting referenced base tables and declared CTE names. */
function scanSerializedAst(node: unknown, scan: AstScan = { tables: [], cteNames: new Set() }): AstScan {
	if (Array.isArray(node)) {
		for (const child of node) {
			scanSerializedAst(child, scan);
		}
		return scan;
	}

	if (!node || typeof node !== 'object') {
		return scan;
	}

	const record = node as Record<string, unknown>;
	if (record.type === 'BASE_TABLE' && typeof record.table_name === 'string') {
		scan.tables.push(record.table_name);
	}

	for (const [key, value] of Object.entries(record)) {
		if (key === 'cte_map') {
			collectCteNames(value, scan.cteNames);
		}
		scanSerializedAst(value, scan);
	}

	return scan;
}

/** A cte_map is serialized as `{ map: [{ key: <cte name>, value: <definition> }] }`. */
function collectCteNames(cteMap: unknown, names: Set<string>): void {
	const entries = (cteMap as { map?: unknown[] } | null)?.map;
	if (!Array.isArray(entries)) {
		return;
	}

	for (const entry of entries) {
		const name = (entry as { key?: unknown } | null)?.key;
		if (typeof name === 'string') {
			names.add(name);
		}
	}
}

async function lockDownExternalAccess(connection: DuckDBConnection): Promise<void> {
	await connection.run('SET enable_external_access = false');
	await connection.run('SET lock_configuration = true');
}

/**
 * Loads rows through a newline-delimited JSON file so DuckDB infers the column
 * types itself rather than us guessing them from JavaScript values.
 */
async function createQueryResultTable(
	connection: DuckDBConnection,
	workspace: string,
	queryId: string,
	queryResult: QueryResult,
): Promise<void> {
	const table = quoteIdentifier(queryId);

	if (queryResult.data.length === 0) {
		const columns = queryResult.columns.map((column) => `${quoteIdentifier(column)} VARCHAR`);
		await connection.run(`CREATE TABLE ${table} (${columns.join(', ') || '"_empty" VARCHAR'})`);
		return;
	}

	const rowsFile = join(workspace, `${crypto.randomUUID()}.jsonl`);
	await writeFile(rowsFile, queryResult.data.map((row) => JSON.stringify(row, replaceUnsupportedJson)).join('\n'));
	await connection.run(
		`CREATE TABLE ${table} AS SELECT * FROM read_json_auto(${quoteLiteral(rowsFile)}, format = 'newline_delimited', sample_size = -1)`,
	);
}

function replaceUnsupportedJson(_key: string, value: unknown): unknown {
	return typeof value === 'bigint' ? value.toString() : value;
}

function quoteIdentifier(identifier: string): string {
	return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteLiteral(literal: string): string {
	return `'${literal.replaceAll("'", "''")}'`;
}
