import z from 'zod/v3';

export const chartTypeEnum = z.enum(['bar', 'line', 'pie']);

export const xAxisTypeEnum = z.enum(['date', 'number', 'category']);

export const seriesConfigSchema = z.object({
	data_key: z.string().describe('Column name from SQL result to plot.'),
	color: z.string().describe('CSS color (defaults to theme colors).'),
});

export const description = 'Display a chart visualization of the data from a previous `execute_sql` tool call.';

export const inputSchema = z.object({
	query_id: z.string().describe("The id of a previous `execute_sql` tool call's output to get data from."),
	chart_type: chartTypeEnum.describe('Type of chart to display.'),
	x_axis_key: z.string().describe('Column name for X-axis/category labels.'),
	x_axis_type: xAxisTypeEnum
		.nullable()
		.describe(
			'Type of x-axis data for range controls. Use "date" only if values are parseable by JS Date(). Set to null for simple count filtering.',
		),
	series: z
		.array(seriesConfigSchema)
		.min(1)
		.describe('Columns to plot as data series (at least one series required).'),
	title: z
		.string()
		.describe(
			'A concise and descriptive title of what the chart shows. Do not include the type of chart in the title or other chart configurations.',
		),
});

export const outputSchema = z
	.object({
		error: z.string().optional().describe('Error message if validation failed'),
	})
	.or(
		z.object({
			success: z.literal(true),
		}),
	);

export type ChartType = z.infer<typeof chartTypeEnum>;
export type XAxisType = z.infer<typeof xAxisTypeEnum>;
export type SeriesConfig = z.infer<typeof seriesConfigSchema>;
export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;
