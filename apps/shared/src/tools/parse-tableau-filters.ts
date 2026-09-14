import z from 'zod/v3';

export const description = [
	'Parse worksheet or dashboard filters from a downloaded Tableau .twb or .twbx.',
	'Returns filter definitions, parameters, dashboard controls, worksheet targeting, and warnings.',
	'Use the extracted definitions to create story filters and matching SQL templates.',
].join(' ');

export const InputSchema = z.object({
	file_path: z
		.string()
		.optional()
		.describe('Path to a .twb or .twbx in the nao project or /home storage, or Tableau MCP temp storage.'),
	workbook_xml: z.string().optional().describe('Raw .twb XML returned by Tableau.'),
	workbook_base64: z.string().optional().describe('Base64-encoded .twb or .twbx bytes.'),
	worksheet: z.string().optional().describe('Optional worksheet name to return only that worksheet.'),
	dashboard: z.string().optional().describe('Optional dashboard name to return only that dashboard.'),
});

const FilterSchema = z.object({
	field: z.string(),
	caption: z.string().optional(),
	data_source: z.string().optional(),
	filter_type: z.string().optional(),
	context: z.boolean(),
	mode: z.enum(['include', 'exclude']).optional(),
	values: z.array(z.string()),
	target_worksheets: z.array(z.string()),
	raw_expression: z.string().optional(),
});

const ParameterSchema = z.object({
	field: z.string(),
	caption: z.string().optional(),
	data_type: z.string().optional(),
	current_value: z.string().optional(),
	allowed_values: z.array(z.string()),
	target_worksheets: z.array(z.string()),
});

const ControlSchema = z.object({
	type: z.enum(['filter', 'parameter']),
	dashboard: z.string(),
	field: z.string().optional(),
	source_worksheet: z.string().optional(),
	target_worksheets: z.array(z.string()),
});

export const FilterDefinitionSchema = z.object({
	filters: z.array(FilterSchema),
	parameters: z.array(ParameterSchema),
	controls: z.array(ControlSchema),
	warnings: z.array(z.string()),
});

export const OutputSchema = z.object({
	_version: z.literal('1'),
	success: z.boolean(),
	error: z.string().optional(),
	definition: FilterDefinitionSchema.optional(),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
export type FilterDefinition = z.infer<typeof FilterDefinitionSchema>;
