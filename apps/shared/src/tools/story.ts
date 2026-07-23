import z from 'zod/v3';

export const MENTION_ID = '__story__';
export const MENTION_TRIGGER = '#';

export const InputSchema = z.object({
	action: z
		.enum(['create', 'update', 'replace'])
		.describe(
			'The operation: "create" initializes a new story, "update" does a search-and-replace (new version), "replace" overwrites the entire content (new version).',
		),
	id: z
		.string()
		.describe(
			'Unique identifier for this story. Use a short, descriptive kebab-case slug (e.g. "revenue-dashboard").',
		),
	title: z.string().optional().describe('A concise, descriptive title for the story. Required for "create".'),
	code: z
		.string()
		.optional()
		.describe(
			'The markdown content. Required for "create" (initial content) and "replace" (new content). Can include charts via <chart query_id="..." /> blocks and SQL tables via <table query_id="..." /> blocks. Use <grid>...</grid> to lay out 2–4 charts/tables side by side, optionally with widths="2,1" (comma-separated positive integers, one per column) for unequal column widths. Use <tab title="...">...</tab> blocks for a tabbed layout.',
		),
	search: z.string().optional().describe('The exact text to find in the current story code. Required for "update".'),
	replace: z.string().optional().describe('The replacement text. Required for "update".'),
});

export const OutputSchema = z.object({
	_version: z.literal('1').optional(),
	success: z.boolean(),
	id: z.string(),
	version: z.number(),
	code: z.string().describe('The full story code after the operation.'),
	title: z.string(),
	error: z.string().optional(),
	template_warnings: z.array(z.string()).optional(),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
