import z from 'zod/v3';

export const InputSchema = z.object({
	pattern: z.string().describe('The regex pattern to search for in file contents.'),
	path: z
		.string()
		.optional()
		.describe('File or directory path to search in. Defaults to project root if not specified.'),
	glob: z
		.string()
		.optional()
		.describe('Glob pattern to filter files (e.g. "*.ts", "*.{js,jsx}"). Applied recursively.'),
	case_insensitive: z.boolean().optional().describe('Case insensitive search. Defaults to false.'),
	context_lines: z.number().optional().describe('Number of context lines before and after each match.'),
	max_results: z.number().optional().describe('Maximum number of matches to return. Defaults to 100.'),
});

export const OutputSchema = z.object({
	matches: z.array(
		z.object({
			path: z.string().describe('Virtual path of the file containing the match.'),
			line_number: z.number().describe('Line number of the match (1-indexed).'),
			line_content: z.string().describe('Content of the matching line.'),
			context_before: z.array(z.string()).optional().describe('Lines before the match.'),
			context_after: z.array(z.string()).optional().describe('Lines after the match.'),
		}),
	),
	total_matches: z.number().describe('Total number of matches found.'),
	truncated: z.boolean().describe('Whether results were truncated due to max_results limit.'),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
