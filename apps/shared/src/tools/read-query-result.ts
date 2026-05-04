import z from 'zod/v3';

import { QueryIdSchema } from './query-id';

export const InputSchema = z.object({
	query_id: z
		.string()
		.describe(
			'The id of a previous `execute_sql` tool call (e.g. "query_a1b2c3d4"). The query result must be from this conversation.',
		),
	offset: z.number().int().min(0).optional().describe('Row index to start reading from (0-based, default 0).'),
	limit: z.number().int().min(1).optional().describe('Maximum number of rows to return (default 20).'),
});

export const OutputSchema = z.object({
	_version: z.literal('1').optional(),
	id: QueryIdSchema,
	columns: z.array(z.string()),
	data: z.array(z.any()),
	/** Total number of rows available in the underlying query result. */
	row_count: z.number(),
	/** The 0-based index of the first row in `data`. */
	offset: z.number(),
	/** The maximum number of rows the caller asked for. */
	limit: z.number(),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
