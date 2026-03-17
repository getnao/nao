import type { CitationPayload, ColumnLineageNode } from '@nao/shared';
import { getSourceTables, lineage } from '@polyglot-sql/sdk';

import { ensurePolyglotInitialized, extractLineageNode } from '../utils/citation';
import { getExecuteSqlPartByQueryId } from './chart-image';

export async function getCitations(queryId: string, column: string): Promise<CitationPayload> {
	const match = await getExecuteSqlPartByQueryId(queryId);
	const input = match.toolInput as { sql_query: string; database_id?: string };
	const sqlQuery = input.sql_query;
	const databaseId = input.database_id ?? '';

	await ensurePolyglotInitialized();

	const tablesResult = getSourceTables(column, sqlQuery);
	const tables =
		tablesResult.success && tablesResult.tables ? tablesResult.tables.map((name: string) => ({ name })) : [];

	const lineageResult = lineage(column, sqlQuery);
	const columnLineage: ColumnLineageNode =
		lineageResult.success && lineageResult.lineage
			? extractLineageNode(lineageResult.lineage)
			: { name: column, source_name: '', sources: [] };

	return {
		sql_query: sqlQuery,
		database_id: databaseId,
		tables,
		column_lineage: columnLineage,
	};
}
