import z from 'zod/v3';

export const description = [
	'Parse dashboard composition from a downloaded Tableau .twb or .twbx.',
	'Returns dashboard worksheet membership, layout zones, dimensions, flow direction, and filter or parameter controls.',
	'Use this instead of guessing dashboard membership from worksheet names.',
].join(' ');

export const InputSchema = z.object({
	file_path: z.string().optional().describe('Path to a .twb or .twbx in the nao project or /home storage.'),
	workbook_xml: z.string().optional().describe('Raw .twb XML returned by Tableau.'),
	workbook_base64: z.string().optional().describe('Base64-encoded .twb or .twbx bytes.'),
	dashboard: z.string().optional().describe('Optional dashboard name to return only that dashboard.'),
});

const ZoneSchema = z.object({
	id: z.string(),
	parent_id: z.string().optional(),
	type: z.string().optional(),
	name: z.string().optional(),
	worksheet: z.string().optional(),
	x: z.number().optional(),
	y: z.number().optional(),
	width: z.number().optional(),
	height: z.number().optional(),
	flow_direction: z.enum(['horizontal', 'vertical']).optional(),
	floating: z.boolean().optional(),
});

const ControlSchema = z.object({
	type: z.enum(['filter', 'parameter']),
	field: z.string().optional(),
	worksheet: z.string().optional(),
});

const DashboardSchema = z.object({
	name: z.string(),
	width: z.number().optional(),
	height: z.number().optional(),
	worksheets: z.array(z.string()),
	layout_rows: z.array(z.array(z.string())),
	zones: z.array(ZoneSchema),
	controls: z.array(ControlSchema),
});

export const WorkbookCompositionSchema = z.object({
	worksheets: z.array(z.string()),
	dashboards: z.array(DashboardSchema),
	skipped_worksheets: z.array(z.string()),
	warnings: z.array(z.string()),
});

export const OutputSchema = z.object({
	_version: z.literal('1'),
	success: z.boolean(),
	error: z.string().optional(),
	workbook: WorkbookCompositionSchema.optional(),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
export type WorkbookComposition = z.infer<typeof WorkbookCompositionSchema>;
export type Dashboard = z.infer<typeof DashboardSchema>;
