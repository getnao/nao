import z from 'zod/v3';

import { QueryIdSchema } from './query-id';

export const InputSchema = z.object({
	sql_query: z.string().describe('The SQL query to execute'),
	database_id: z
		.string()
		.optional()
		.describe('The database name/id to use. Required if multiple databases are configured.'),
	name: z.string().optional().describe('A descriptive name for the query that will be used to show in the UI.'),
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
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
