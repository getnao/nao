import z from 'zod/v3';

export const InputSchema = z.object({
	query: z
		.string()
		.describe(
			'What you are looking for, in plain language: the question, metric, entity or business term. Include synonyms the files may use.',
		),
	path: z
		.string()
		.optional()
		.describe('Folder to search in, e.g. /databases, /semantics or /docs. Defaults to the whole project.'),
	max_results: z.number().int().min(1).max(20).optional().describe('How many results to return. Defaults to 8.'),
});

export const ResultSchema = z.object({
	path: z.string(),
	type: z.enum(['file', 'directory']),
	relevance: z.number().describe('Probability, between 0 and 1, that this entry contains what the query needs.'),
	excerpt: z.string(),
});

export const OutputSchema = z.object({
	_version: z.literal('1'),
	results: z.array(ResultSchema),
	candidates: z.number().describe('How many files and table folders were ranked.'),
	coverage: z.number().describe('Probability, between 0 and 1, that the folder covers the query at all.'),
});

export type Input = z.infer<typeof InputSchema>;
export type Result = z.infer<typeof ResultSchema>;
export type Output = z.infer<typeof OutputSchema>;
