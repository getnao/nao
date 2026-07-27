import z from 'zod/v3';

export const MapTypeEnum = z.enum(['points']);

export const InputSchema = z.object({
	query_id: z.string().describe("The id of a previous `execute_sql` tool call's output to get data from."),
	map_type: MapTypeEnum.describe('Type of map visualization to display.'),
	latitude_key: z.string().describe('Column name containing the latitude in WGS84 decimal degrees.'),
	longitude_key: z.string().describe('Column name containing the longitude in WGS84 decimal degrees.'),
	label_key: z
		.string()
		.optional()
		.describe('Column name used as the title of the popup shown when a point is clicked.'),
	tooltip_keys: z
		.array(z.string())
		.optional()
		.describe('Additional column names to display as label/value rows in the point popup.'),
	title: z
		.string()
		.describe(
			'A concise and descriptive title of what the map shows. Do not include the type of map in the title or other map configurations.',
		),
});

export const OutputSchema = z.object({
	_version: z.literal('1').optional(),
	success: z.boolean(),
	error: z.string().optional(),
	warning: z.string().optional(),
	point_count: z.number().optional(),
	dropped_row_count: z.number().optional(),
});

export type MapType = z.infer<typeof MapTypeEnum>;
export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
