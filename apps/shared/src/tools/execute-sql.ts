import z from 'zod/v3';

import { QueryIdSchema } from './query-id';

/**
 * Addresses nao's own DuckDB engine rather than a configured warehouse. Always available, and
 * the only way to query a file or join one against an earlier query result. The name is
 * reserved: a warehouse configured under it would be unreachable.
 */
export const LOCAL_DATABASE_ID = 'duckdb_local';

export const InputSchema = z.object({
	sql_query: z.string().describe('The SQL query to execute'),
	database_id: z
		.string()
		.optional()
		.describe(
			`The database name/id to use. Required if multiple databases are configured. Pass "${LOCAL_DATABASE_ID}" to use nao's built-in DuckDB instead of a warehouse: it reads files (CSV, JSON, Parquet, Excel) by their path, exposes every earlier query result as a table named after its query id, and can join the two together.`,
		),
	name: z.string().optional().describe('A descriptive name for the query that will be used to show in the UI.'),
	query_id: QueryIdSchema.optional().describe(
		'When set, replace the SQL of this existing query in-place (same query_id) instead of creating a new one. Prefer this when adding story filter templates so chart/table tags keep working.',
	),
});

export const OutputSchema = z.object({
	_version: z.literal('1').optional(),
	data: z.array(z.any()),
	row_count: z.number(),
	columns: z.array(z.string()),
	/** The id of the query result. May be referenced by the `display_chart` tool call. */
	id: QueryIdSchema,
	dialect: z.string().optional(),
	/**
	 * The row limit applied by the outermost query (LIMIT/TOP/FETCH FIRST), if any.
	 * When `row_count` equals this value the result is likely truncated and does not
	 * represent the total number of matching rows.
	 */
	applied_limit: z.number().optional(),
	/**
	 * Story-filter SQL template syntax issues. The stripped query may still execute,
	 * but filters will not apply correctly until these are fixed via execute_sql with query_id.
	 */
	template_warnings: z.array(z.string()).optional(),
	/**
	 * Set in-memory (never persisted) when a later execute_sql part in the chat re-ran
	 * the same query id. The model then sees a short stub instead of repeated rows.
	 */
	superseded: z.boolean().optional(),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
