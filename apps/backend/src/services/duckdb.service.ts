import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';

import type { QueryResult } from '../types/tools';

/**
 * Runs a query in an in-memory DuckDB where every given query result is a table
 * named after its query id. Lets callers reshape warehouse rows they already
 * hold instead of moving them through an LLM.
 */
export async function runSqlOverQueryResults(
	queryResults: Map<string, QueryResult>,
	sql: string,
): Promise<QueryResult> {
	const workspace = await mkdtemp(join(tmpdir(), 'nao-query-results-'));
	const instance = await DuckDBInstance.create(':memory:');
	const connection = await instance.connect();

	try {
		for (const [queryId, queryResult] of queryResults) {
			await createQueryResultTable(connection, workspace, queryId, queryResult);
		}

		const reader = await connection.runAndReadAll(sql);
		return { columns: reader.columnNames(), data: reader.getRowObjectsJson() };
	} finally {
		connection.closeSync();
		instance.closeSync();
		await rm(workspace, { recursive: true, force: true });
	}
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

	const rowsFile = join(workspace, `${queryId}.jsonl`);
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
