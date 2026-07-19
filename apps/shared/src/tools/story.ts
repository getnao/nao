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
			`The markdown content. Required for "create" (initial content) and "replace" (new content). Can include charts via <chart query_id="..." /> blocks and SQL tables via <table query_id="..." /> blocks. Use <grid cols="2">...</grid> to lay out charts side by side in a responsive grid. Default to a single flowing story. Use <tabs> only when the user asks for tabs, or when the content splits into clearly distinct sections that are better separated than stacked (e.g. overview vs. detail, one topic/department/metric per tab). Avoid tabs for a short or single-topic story. Always follow the user's explicit request (e.g. "a tab per chart" → one chart per tab). When using tabs, the story must start with <tabs> and contain only <tab title="…">…</tab> blocks — no text outside a tab.

<tabs>
<tab title="Overview">
## Summary
Key takeaways...
</tab>
<tab title="Revenue">
<chart query_id="..." chart_type="bar" x_axis_key="..." series='[{"data_key": "revenue"}]' title="Revenue" />
</tab>
</tabs>`,
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
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
