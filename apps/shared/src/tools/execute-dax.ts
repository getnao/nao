import z from 'zod/v3';

export const InputSchema = z.object({
	dax_query: z.string().describe('DAX query starting with EVALUATE'),
	database_id: z
		.string()
		.optional()
		.describe('Power BI dataset name. Required when multiple powerbi_xmla databases are configured.'),
	name: z.string().optional().describe('A descriptive name for this query shown in the UI.'),
});

export const OutputSchema = z.object({
	_version: z.literal('1').optional(),
	data: z.array(z.any()),
	row_count: z.number(),
	columns: z.array(z.string()),
	dialect: z.literal('powerbi_xmla').optional(),
	id: z.custom<`query_${string}`>(),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
