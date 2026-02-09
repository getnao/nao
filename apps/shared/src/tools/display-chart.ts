import z from 'zod/v3';

export const ChartTypeEnum = z.enum(['bar', 'line', 'pie']);

export const XAxisTypeEnum = z.enum(['date', 'number', 'category']);

export const SeriesConfigSchema = z.object({
	data_key: z.string().describe('Column name from SQL result to plot.'),
	color: z.string().describe('CSS color (defaults to theme colors).'),
});

export const InputSchema = z.object({
	query_id: z.string().describe("The id of a previous `execute_sql` tool call's output to get data from."),
	chart_type: ChartTypeEnum.describe('Type of chart to display.'),
	x_axis_key: z.string().describe('Column name for X-axis/category labels.'),
	x_axis_type: XAxisTypeEnum.nullable().describe(
		'Type of x-axis data for range controls. Use "date" only if values are parseable by JS Date(). Set to null for simple count filtering.',
	),
	series: z
		.array(SeriesConfigSchema)
		.min(1)
		.describe('Columns to plot as data series (at least one series required).'),
	title: z
		.string()
		.describe(
			'A concise and descriptive title of what the chart shows. Do not include the type of chart in the title or other chart configurations.',
		),
});

export const OutputSchema = z
	.object({
		error: z.string().optional().describe('Error message if validation failed'),
	})
	.or(
		z.object({
			success: z.literal(true),
		}),
	);

export type ChartType = z.infer<typeof ChartTypeEnum>;
export type XAxisType = z.infer<typeof XAxisTypeEnum>;
export type SeriesConfig = z.infer<typeof SeriesConfigSchema>;
export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
