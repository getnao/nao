import z from 'zod/v3';

import { OutputSchema as ExecuteSqlOutputSchema } from './execute-sql';

export const InputSchema = z.object({
	metrics: z
		.array(z.string())
		.min(1)
		.describe('Metric names as documented in semantics/metrics/, e.g. ["revenue", "orders"].'),
	group_by: z
		.array(z.string())
		.optional()
		.describe(
			'Dimensions or entities to group by, as entity__dimension names (e.g. "customer__region"). Time dimensions take a granularity suffix: "metric_time__month", "order__ordered_at__week". Every metric supports metric_time.',
		),
	where: z
		.array(z.string())
		.optional()
		.describe(
			"SQL filters, ANDed together. Reference model fields through templates so the layer resolves the joins: {{ Dimension('customer__region') }} = 'EMEA', {{ TimeDimension('metric_time', 'day') }} >= '2024-01-01', {{ Entity('customer') }} = 42, {{ Metric('revenue', group_by=['customer']) }} > 100. Bare column names are not resolved.",
		),
	order_by: z
		.array(z.string())
		.optional()
		.describe('Metrics or group_by items to sort by; prefix with "-" for descending, e.g. ["-revenue"].'),
	limit: z.number().int().positive().optional().describe('Maximum number of rows to return.'),
	start_time: z.string().optional().describe('Inclusive ISO date lower bound on metric_time, e.g. "2024-01-01".'),
	end_time: z.string().optional().describe('Inclusive ISO date upper bound on metric_time, e.g. "2024-12-31".'),
	name: z.string().optional().describe('A descriptive name for the query that will be used to show in the UI.'),
});

/** Same shape as an execute_sql result, so charts, stories and read_query_result treat it as one. */
export const OutputSchema = ExecuteSqlOutputSchema.extend({
	/** The SQL the semantic layer compiled and ran. Shown in the UI, never sent back to the model. */
	compiled_sql: z.string(),
	/** The database the compiled SQL ran on, chosen by the semantic layer configuration. */
	database_id: z.string(),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
