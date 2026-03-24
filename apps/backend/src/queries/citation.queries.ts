import type { CitationPayload } from '@nao/shared';
import { Parser } from 'node-sql-parser';

import { buildColumnLineage, extractTables } from '../utils/citation';
import { getExecuteSqlPartByQueryId } from './chart-image';

const parser = new Parser();

export async function getCitations(queryId: string, column: string): Promise<CitationPayload> {
	const match = await getExecuteSqlPartByQueryId(queryId);
	const input = match.toolInput as { sql_query: string; database_id?: string };
	const sqlQuery = input.sql_query;

	try {
		const { tableList, ast } = parser.parse(sqlQuery);
		const tables = extractTables(tableList);
		const columnLineage = buildColumnLineage(column, ast, parser);

		return {
			sql_query: sqlQuery,
			database_id: input.database_id ?? '',
			tables,
			column_lineage: columnLineage,
		};
	} catch (error) {
		console.error('Failed to parse SQL query:', error instanceof Error ? error.message : error);
		return {
			sql_query: sqlQuery,
			database_id: input.database_id ?? '',
			tables: [],
			column_lineage: { name: column, source_name: '', sources: [] },
		};
	}
}
